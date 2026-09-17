import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@top/database";
import type { createTenantSafePrismaClient } from "@top/database";
import type { TenantTransactionClient } from "../database/database.module";
import type { AddRfqItemInput, AddRfqSupplierInput, CancelRfqInput, CloseRfqInput, CreateRfqInput, ListRfqsQuery, UpdateRfqInput } from "@top/validation";
import type { RfqDetail, RfqItemView, RfqListResult, RfqSummary, RfqSupplierView } from "@top/types";
import { TENANT_PRISMA } from "../database/database.module";
import { AuditService } from "../common/audit/audit.service";
import { ENTITY_SEQUENCE_TYPE, EntitySequenceService } from "../common/entity-sequence/entity-sequence.service";
import { formatRfqNumber } from "../common/entity-sequence/rfq-number.util";
import { computeRfqCreateHash } from "./rfq-create-hash.util";
import { isRetryableTransactionError } from "../stock/transaction-conflict.util";
import { lockPurchaseRequest, lockRfq, lockSelectedRfqSuppliers, lockSuppliersByIds } from "./rfq-locks";

type TenantDb = ReturnType<typeof createTenantSafePrismaClient>;

/** Statuses a source PurchaseRequest must be in for an RFQ to be created against it, or sent from (Revision 1 D2/§12/§35). */
const RFQ_ELIGIBLE_PR_STATUSES = new Set(["APPROVED", "RFQ_IN_PROGRESS"]);

const MAX_TRANSACTION_RETRIES = 1;

/** Same shape/reasoning as PurchaseRequestsService/SuppliersService's own marker — never escapes this file uncaught. */
class IdempotencyConflictMarker extends Error {}

const rfqDetailInclude = {
  purchaseRequest: { select: { id: true, requestNumber: true, status: true } },
  items: true,
  suppliers: { include: { supplier: { select: { status: true } } } },
} satisfies Prisma.RFQInclude;

type RfqDetailRow = Prisma.RFQGetPayload<{ include: typeof rfqDetailInclude }>;

const rfqListInclude = {
  purchaseRequest: { select: { id: true, requestNumber: true } },
  _count: { select: { items: true, suppliers: true } },
} satisfies Prisma.RFQInclude;

type RfqListRow = Prisma.RFQGetPayload<{ include: typeof rfqListInclude }>;

@Injectable()
export class RfqsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly sequences: EntitySequenceService
  ) {}

  // ────────────────────────────────────────────────────────────
  // CREATE
  // ────────────────────────────────────────────────────────────

  async create(organizationId: string, actorUserId: string, input: CreateRfqInput): Promise<RfqDetail> {
    // RolesGuard has already run before this method is ever called
    // (Revision 1 §13: authorization happens before idempotency replay).
    const payloadHash = input.idempotencyKey ? computeRfqCreateHash(input) : undefined;

    if (input.idempotencyKey) {
      const existing = await this.db.rFQ.findFirst({ where: { organizationId, idempotencyKey: input.idempotencyKey } });
      if (existing) {
        return this.resolveIdempotentReplay(organizationId, existing, payloadHash!);
      }
    }

    const id = await this.attempt(organizationId, actorUserId, input, payloadHash, MAX_TRANSACTION_RETRIES);
    return this.loadDetail(organizationId, id);
  }

  private async resolveIdempotentReplay(organizationId: string, existing: { id: string; payloadHash: string | null }, payloadHash: string): Promise<RfqDetail> {
    if (existing.payloadHash !== payloadHash) {
      throw new ConflictException("idempotencyKey was already used with a different request payload");
    }
    return this.loadDetail(organizationId, existing.id);
  }

  private async attempt(
    organizationId: string,
    actorUserId: string,
    input: CreateRfqInput,
    payloadHash: string | undefined,
    retriesLeft: number
  ): Promise<string> {
    try {
      return await this.db.$transaction((tx) => this.executeCreate(tx, organizationId, actorUserId, input, payloadHash));
    } catch (err) {
      if (err instanceof IdempotencyConflictMarker) {
        if (!input.idempotencyKey) throw err; // unreachable — marker only thrown when a key was supplied
        const existing = await this.db.rFQ.findFirst({ where: { organizationId, idempotencyKey: input.idempotencyKey } });
        if (existing) {
          const detail = await this.resolveIdempotentReplay(organizationId, existing, payloadHash!);
          return detail.id;
        }
        throw new ConflictException("Idempotency key conflict could not be resolved");
      }

      const isRaceOrDeadlock =
        isRetryableTransactionError(err) || (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002");
      if (isRaceOrDeadlock && retriesLeft > 0) {
        return this.attempt(organizationId, actorUserId, input, payloadHash, retriesLeft - 1);
      }
      throw err;
    }
  }

  private async executeCreate(
    tx: TenantTransactionClient,
    organizationId: string,
    actorUserId: string,
    input: CreateRfqInput,
    payloadHash: string | undefined
  ): Promise<string> {
    // Lock order: PurchaseRequest -> Suppliers ordered by id (Revision 1 §10 "CREATE with initial Suppliers").
    const pr = await lockPurchaseRequest(tx, organizationId, input.purchaseRequestId);
    if (!RFQ_ELIGIBLE_PR_STATUSES.has(pr.status)) {
      throw new ConflictException("Purchase request is not in an eligible status for RFQ creation");
    }

    const prItems = input.purchaseRequestItemIds.length
      ? await tx.purchaseRequestItem.findMany({ where: { id: { in: input.purchaseRequestItemIds }, purchaseRequestId: pr.id } })
      : [];
    if (prItems.length !== input.purchaseRequestItemIds.length) {
      throw new NotFoundException("One or more purchase request items were not found on the source purchase request");
    }

    const lockedSuppliers = await lockSuppliersByIds(tx, organizationId, input.supplierIds);
    if (lockedSuppliers.length !== input.supplierIds.length) {
      throw new NotFoundException("One or more suppliers were not found");
    }
    const inactive = lockedSuppliers.filter((s) => s.status !== "ACTIVE");
    if (inactive.length > 0) {
      const names = inactive.map((s) => `${s.supplierCode} (${s.companyName})`).join(", ");
      throw new BadRequestException(`The following suppliers are not ACTIVE and cannot be selected: ${names}`);
    }

    const year = new Date().getFullYear();
    const sequenceValue = await this.sequences.nextValue(tx, organizationId, ENTITY_SEQUENCE_TYPE.RFQ, year);
    const rfqNumber = formatRfqNumber(year, sequenceValue);

    let rfq: { id: string };
    try {
      rfq = await tx.rFQ.create({
        data: {
          organizationId,
          purchaseRequestId: pr.id,
          rfqNumber,
          deadline: input.deadline ? new Date(input.deadline) : null,
          supplierInstructions: input.supplierInstructions ?? null,
          internalNotes: input.internalNotes ?? null,
          createdById: actorUserId,
          idempotencyKey: input.idempotencyKey ?? null,
          payloadHash: payloadHash ?? null,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new IdempotencyConflictMarker();
      }
      throw err;
    }

    for (const item of prItems) {
      await tx.rFQItem.create({
        data: {
          rfqId: rfq.id,
          purchaseRequestItemId: item.id,
          productId: item.productId,
          itemName: item.itemName,
          skuSnapshot: item.skuSnapshot,
          description: item.description,
          quantity: item.quantity,
          uomCode: item.uomCode,
          technicalSpec: (item.technicalSpec ?? undefined) as Prisma.InputJsonValue | undefined,
          requiredDate: item.requiredDate,
          internalItemNote: item.notes,
        },
      });
    }

    for (const supplier of lockedSuppliers) {
      await tx.rFQSupplier.create({
        data: {
          rfqId: rfq.id,
          supplierId: supplier.id,
          supplierCodeSnapshot: supplier.supplierCode,
          companyNameSnapshot: supplier.companyName,
          status: "SELECTED",
          portalTokenHash: null,
          tokenExpiresAt: null,
          invitedAt: null,
        },
      });
    }

    // Revision 1 §20: ONE RFQ_CREATED audit for the whole creation, never
    // separate RFQ_ITEM_ADDED/RFQ_SUPPLIER_ADDED rows for items/suppliers
    // supplied inside the initial create request.
    await this.audit.log(
      {
        organizationId,
        userId: actorUserId,
        action: "RFQ_CREATED",
        entityType: "RFQ",
        entityId: rfq.id,
        newValue: {
          rfqNumber,
          purchaseRequestId: pr.id,
          itemCount: prItems.length,
          supplierCount: lockedSuppliers.length,
          deadline: input.deadline ?? null,
        },
      },
      tx
    );

    return rfq.id;
  }

  // ────────────────────────────────────────────────────────────
  // READ
  // ────────────────────────────────────────────────────────────

  async list(organizationId: string, query: ListRfqsQuery): Promise<RfqListResult> {
    const where: Prisma.RFQWhereInput = {
      organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.purchaseRequestId ? { purchaseRequestId: query.purchaseRequestId } : {}),
      ...(query.createdAtFrom || query.createdAtTo
        ? {
            createdAt: {
              ...(query.createdAtFrom ? { gte: new Date(query.createdAtFrom) } : {}),
              ...(query.createdAtTo ? { lte: new Date(query.createdAtTo) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { rfqNumber: { contains: query.search, mode: Prisma.QueryMode.insensitive } },
              { purchaseRequest: { requestNumber: { contains: query.search, mode: Prisma.QueryMode.insensitive } } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.db.rFQ.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { rfqNumber: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: rfqListInclude,
      }),
      this.db.rFQ.count({ where }),
    ]);

    return { items: (rows as RfqListRow[]).map(toRfqSummary), total, page: query.page, pageSize: query.pageSize };
  }

  async get(organizationId: string, id: string): Promise<RfqDetail> {
    return this.loadDetail(organizationId, id);
  }

  private async loadDetail(organizationId: string, id: string): Promise<RfqDetail> {
    const rfq = (await this.db.rFQ.findFirst({ where: { id, organizationId }, include: rfqDetailInclude })) as RfqDetailRow | null;
    if (!rfq) throw new NotFoundException("RFQ not found");
    return toRfqDetail(rfq);
  }

  private async loadDetailTx(tx: TenantTransactionClient, organizationId: string, id: string): Promise<RfqDetail> {
    const rfq = (await tx.rFQ.findFirstOrThrow({ where: { id, organizationId }, include: rfqDetailInclude })) as RfqDetailRow;
    return toRfqDetail(rfq);
  }

  // ────────────────────────────────────────────────────────────
  // DRAFT HEADER PATCH
  // ────────────────────────────────────────────────────────────

  async update(organizationId: string, actorUserId: string, id: string, input: UpdateRfqInput): Promise<RfqDetail> {
    return this.db.$transaction(async (tx) => {
      const rfq = await lockRfq(tx, organizationId, id);
      this.requireDraft(rfq.status);

      const data: Prisma.RFQUncheckedUpdateInput = {};
      const newValue: Record<string, unknown> = {};

      if (input.deadline !== undefined) {
        const next = input.deadline ? new Date(input.deadline) : null;
        const changed = (rfq.deadline?.getTime() ?? null) !== (next?.getTime() ?? null);
        if (changed) {
          data.deadline = next;
          newValue.deadline = next?.toISOString() ?? null;
        }
      }
      if (input.supplierInstructions !== undefined) {
        const changed = (rfq.supplierInstructions ?? null) !== (input.supplierInstructions ?? null);
        if (changed) {
          data.supplierInstructions = input.supplierInstructions;
          newValue.supplierInstructions = input.supplierInstructions;
        }
      }
      if (input.internalNotes !== undefined) {
        const changed = (rfq.internalNotes ?? null) !== (input.internalNotes ?? null);
        if (changed) {
          data.internalNotes = input.internalNotes;
          newValue.internalNotes = input.internalNotes;
        }
      }

      if (Object.keys(data).length === 0) {
        return this.loadDetailTx(tx, organizationId, rfq.id);
      }

      await tx.rFQ.update({ where: { id: rfq.id }, data });

      await this.audit.log(
        { organizationId, userId: actorUserId, action: "RFQ_UPDATED", entityType: "RFQ", entityId: rfq.id, newValue },
        tx
      );

      return this.loadDetailTx(tx, organizationId, rfq.id);
    });
  }

  // ────────────────────────────────────────────────────────────
  // DRAFT ITEMS
  // ────────────────────────────────────────────────────────────

  async addItem(organizationId: string, actorUserId: string, id: string, input: AddRfqItemInput): Promise<RfqItemView> {
    return this.db.$transaction(async (tx) => {
      const rfq = await lockRfq(tx, organizationId, id);
      this.requireDraft(rfq.status);

      const prItem = await tx.purchaseRequestItem.findFirst({ where: { id: input.purchaseRequestItemId, purchaseRequestId: rfq.purchaseRequestId } });
      if (!prItem) throw new NotFoundException("Purchase request item not found on the source purchase request");

      let created;
      try {
        created = await tx.rFQItem.create({
          data: {
            rfqId: rfq.id,
            purchaseRequestItemId: prItem.id,
            productId: prItem.productId,
            itemName: prItem.itemName,
            skuSnapshot: prItem.skuSnapshot,
            description: prItem.description,
            quantity: prItem.quantity,
            uomCode: prItem.uomCode,
            technicalSpec: (prItem.technicalSpec ?? undefined) as Prisma.InputJsonValue | undefined,
            requiredDate: prItem.requiredDate,
            internalItemNote: prItem.notes,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          throw new ConflictException("This purchase request item is already on the RFQ");
        }
        throw err;
      }

      await this.audit.log(
        {
          organizationId,
          userId: actorUserId,
          action: "RFQ_ITEM_ADDED",
          entityType: "RFQItem",
          entityId: created.id,
          newValue: { rfqId: rfq.id, purchaseRequestItemId: prItem.id, itemName: created.itemName, quantity: created.quantity.toString(), uomCode: created.uomCode },
        },
        tx
      );

      return toRfqItemView(created);
    });
  }

  async removeItem(organizationId: string, actorUserId: string, id: string, rfqItemId: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const rfq = await lockRfq(tx, organizationId, id);
      this.requireDraft(rfq.status);

      const existing = await tx.rFQItem.findFirst({ where: { id: rfqItemId, rfqId: rfq.id } });
      if (!existing) throw new NotFoundException("RFQ item not found");

      await tx.rFQItem.delete({ where: { id: rfqItemId } });

      await this.audit.log(
        {
          organizationId,
          userId: actorUserId,
          action: "RFQ_ITEM_REMOVED",
          entityType: "RFQItem",
          entityId: rfqItemId,
          oldValue: { rfqId: rfq.id, purchaseRequestItemId: existing.purchaseRequestItemId, itemName: existing.itemName, quantity: existing.quantity.toString(), uomCode: existing.uomCode },
        },
        tx
      );
    });
  }

  // ────────────────────────────────────────────────────────────
  // DRAFT SUPPLIERS
  // ────────────────────────────────────────────────────────────

  async addSupplier(organizationId: string, actorUserId: string, id: string, input: AddRfqSupplierInput): Promise<RfqSupplierView> {
    return this.db.$transaction(async (tx) => {
      const rfq = await lockRfq(tx, organizationId, id);
      this.requireDraft(rfq.status);

      const locked = await lockSuppliersByIds(tx, organizationId, [input.supplierId]);
      const supplier = locked[0];
      if (!supplier) throw new NotFoundException("Supplier not found");
      if (supplier.status !== "ACTIVE") throw new BadRequestException("Supplier is not ACTIVE");

      let created;
      try {
        created = await tx.rFQSupplier.create({
          data: {
            rfqId: rfq.id,
            supplierId: supplier.id,
            supplierCodeSnapshot: supplier.supplierCode,
            companyNameSnapshot: supplier.companyName,
            status: "SELECTED",
            portalTokenHash: null,
            tokenExpiresAt: null,
            invitedAt: null,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          throw new ConflictException("This supplier is already on the RFQ");
        }
        throw err;
      }

      await this.audit.log(
        {
          organizationId,
          userId: actorUserId,
          action: "RFQ_SUPPLIER_ADDED",
          entityType: "RFQSupplier",
          entityId: created.id,
          newValue: { rfqId: rfq.id, supplierId: supplier.id, supplierCode: supplier.supplierCode, companyName: supplier.companyName },
        },
        tx
      );

      return toRfqSupplierView({ ...created, supplier: { status: supplier.status } });
    });
  }

  async removeSupplier(organizationId: string, actorUserId: string, id: string, rfqSupplierId: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const rfq = await lockRfq(tx, organizationId, id);
      this.requireDraft(rfq.status);

      const existing = await tx.rFQSupplier.findFirst({ where: { id: rfqSupplierId, rfqId: rfq.id } });
      if (!existing) throw new NotFoundException("RFQ supplier not found");

      await tx.rFQSupplier.delete({ where: { id: rfqSupplierId } });

      await this.audit.log(
        {
          organizationId,
          userId: actorUserId,
          action: "RFQ_SUPPLIER_REMOVED",
          entityType: "RFQSupplier",
          entityId: rfqSupplierId,
          oldValue: { rfqId: rfq.id, supplierId: existing.supplierId, supplierCode: existing.supplierCodeSnapshot, companyName: existing.companyNameSnapshot },
        },
        tx
      );
    });
  }

  // ────────────────────────────────────────────────────────────
  // SEND
  // ────────────────────────────────────────────────────────────

  async send(organizationId: string, actorUserId: string, id: string): Promise<RfqDetail> {
    return this.db.$transaction(async (tx) => {
      const rfq = await lockRfq(tx, organizationId, id);

      if (rfq.status === "SENT") {
        return this.loadDetailTx(tx, organizationId, rfq.id);
      }
      if (rfq.status === "CLOSED" || rfq.status === "CANCELLED" || rfq.status === "IN_PROGRESS") {
        throw new ConflictException(`RFQ cannot be sent from status ${rfq.status}`);
      }
      // DRAFT falls through.

      // Lock order: RFQ -> PurchaseRequest -> Suppliers ordered by id (Revision 1 §10 "SEND").
      const pr = await lockPurchaseRequest(tx, organizationId, rfq.purchaseRequestId);
      if (!RFQ_ELIGIBLE_PR_STATUSES.has(pr.status)) {
        throw new ConflictException("Source purchase request is not in an eligible status for RFQ send");
      }

      const itemCount = await tx.rFQItem.count({ where: { rfqId: rfq.id } });
      if (itemCount === 0) throw new BadRequestException("RFQ must have at least one item before it can be sent");

      const lockedSuppliers = await lockSelectedRfqSuppliers(tx, organizationId, rfq.id);
      if (lockedSuppliers.length === 0) throw new BadRequestException("RFQ must have at least one supplier before it can be sent");

      const now = new Date();
      if (!rfq.deadline || rfq.deadline.getTime() <= now.getTime()) {
        throw new BadRequestException("RFQ deadline must be set to a future instant before it can be sent");
      }

      const inactive = lockedSuppliers.filter((s) => s.supplierStatus !== "ACTIVE");
      if (inactive.length > 0) {
        const names = inactive.map((s) => `${s.supplierCode} (${s.companyName})`).join(", ");
        throw new BadRequestException(`The following suppliers are no longer ACTIVE and must be removed before sending: ${names}`);
      }

      // Refresh EVERY selected RFQSupplier's identity snapshot to its value
      // at this exact SEND moment (Revision 1 §14/§37) — unconditional, even
      // if unchanged since add-time.
      for (const s of lockedSuppliers) {
        await tx.rFQSupplier.update({
          where: { id: s.rfqSupplierId },
          data: { supplierCodeSnapshot: s.supplierCode, companyNameSnapshot: s.companyName },
        });
      }

      await tx.rFQ.update({ where: { id: rfq.id }, data: { status: "SENT", sentAt: now } });

      let prTransitioned = false;
      if (pr.status === "APPROVED") {
        await tx.purchaseRequest.update({ where: { id: pr.id }, data: { status: "RFQ_IN_PROGRESS" } });
        prTransitioned = true;
      }

      await this.audit.log(
        {
          organizationId,
          userId: actorUserId,
          action: "RFQ_SENT",
          entityType: "RFQ",
          entityId: rfq.id,
          oldValue: { status: "DRAFT" },
          newValue: { status: "SENT", deadline: rfq.deadline.toISOString(), itemCount, supplierCount: lockedSuppliers.length },
        },
        tx
      );

      if (prTransitioned) {
        await this.audit.log(
          {
            organizationId,
            userId: actorUserId,
            action: "PURCHASE_REQUEST_RFQ_STARTED",
            entityType: "PurchaseRequest",
            entityId: pr.id,
            oldValue: { status: "APPROVED" },
            newValue: { status: "RFQ_IN_PROGRESS", rfqId: rfq.id, rfqNumber: rfq.rfqNumber },
          },
          tx
        );
      }

      return this.loadDetailTx(tx, organizationId, rfq.id);
    });
  }

  // ────────────────────────────────────────────────────────────
  // CLOSE / CANCEL
  // ────────────────────────────────────────────────────────────

  async close(organizationId: string, actorUserId: string, id: string, input: CloseRfqInput): Promise<RfqDetail> {
    return this.db.$transaction(async (tx) => {
      const rfq = await lockRfq(tx, organizationId, id);

      if (rfq.status === "CLOSED") {
        return this.loadDetailTx(tx, organizationId, rfq.id);
      }
      if (rfq.status !== "SENT") {
        throw new ConflictException(`RFQ cannot be closed from status ${rfq.status}`);
      }

      const closedAt = new Date();
      await tx.rFQ.update({ where: { id: rfq.id }, data: { status: "CLOSED", closedAt } });

      // Close reason is audit-context-only — never a durable RFQ column (Revision 1 §11/§39).
      await this.audit.log(
        {
          organizationId,
          userId: actorUserId,
          action: "RFQ_CLOSED",
          entityType: "RFQ",
          entityId: rfq.id,
          oldValue: { status: "SENT" },
          newValue: { status: "CLOSED", closedAt: closedAt.toISOString(), reason: input.reason ?? null },
        },
        tx
      );

      return this.loadDetailTx(tx, organizationId, rfq.id);
    });
  }

  async cancel(organizationId: string, actorUserId: string, id: string, input: CancelRfqInput): Promise<RfqDetail> {
    return this.db.$transaction(async (tx) => {
      const rfq = await lockRfq(tx, organizationId, id);

      if (rfq.status === "CANCELLED") {
        // Never overwrite an already-persisted cancelReason on a repeat call (Revision 1 §87).
        return this.loadDetailTx(tx, organizationId, rfq.id);
      }
      if (rfq.status !== "DRAFT" && rfq.status !== "SENT") {
        throw new ConflictException(`RFQ cannot be cancelled from status ${rfq.status}`);
      }

      const cancelledAt = new Date();
      const cancelReason = input.reason ?? null;
      await tx.rFQ.update({ where: { id: rfq.id }, data: { status: "CANCELLED", cancelledAt, cancelReason } });

      await this.audit.log(
        {
          organizationId,
          userId: actorUserId,
          action: "RFQ_CANCELLED",
          entityType: "RFQ",
          entityId: rfq.id,
          oldValue: { status: rfq.status },
          newValue: { status: "CANCELLED", cancelledAt: cancelledAt.toISOString(), cancelReason },
        },
        tx
      );

      return this.loadDetailTx(tx, organizationId, rfq.id);
    });
  }

  // ────────────────────────────────────────────────────────────
  // Shared helpers
  // ────────────────────────────────────────────────────────────

  private requireDraft(status: string): void {
    if (status !== "DRAFT") throw new ConflictException("RFQ can only be edited while DRAFT");
  }
}

function toRfqItemView(item: {
  id: string;
  purchaseRequestItemId: string;
  productId: string | null;
  itemName: string;
  skuSnapshot: string | null;
  description: string | null;
  quantity: Prisma.Decimal;
  uomCode: string;
  technicalSpec: Prisma.JsonValue;
  requiredDate: Date | null;
  internalItemNote: string | null;
}): RfqItemView {
  return {
    id: item.id,
    purchaseRequestItemId: item.purchaseRequestItemId,
    productId: item.productId,
    itemName: item.itemName,
    skuSnapshot: item.skuSnapshot,
    description: item.description,
    quantity: item.quantity.toString(),
    uomCode: item.uomCode as RfqItemView["uomCode"],
    technicalSpec: (item.technicalSpec as Record<string, unknown> | null) ?? null,
    requiredDate: item.requiredDate?.toISOString() ?? null,
    internalItemNote: item.internalItemNote,
  };
}

function toRfqSupplierView(row: {
  id: string;
  supplierId: string;
  supplierCodeSnapshot: string;
  companyNameSnapshot: string;
  status: string;
  invitedAt: Date | null;
  supplier: { status: string };
}): RfqSupplierView {
  return {
    id: row.id,
    supplierId: row.supplierId,
    supplierCodeSnapshot: row.supplierCodeSnapshot,
    companyNameSnapshot: row.companyNameSnapshot,
    status: row.status as RfqSupplierView["status"],
    invitedAt: row.invitedAt?.toISOString() ?? null,
    currentSupplierStatus: row.supplier.status as RfqSupplierView["currentSupplierStatus"],
  };
}

function toRfqDetail(rfq: RfqDetailRow): RfqDetail {
  return {
    id: rfq.id,
    rfqNumber: rfq.rfqNumber,
    status: rfq.status as RfqDetail["status"],
    deadline: rfq.deadline?.toISOString() ?? null,
    supplierInstructions: rfq.supplierInstructions,
    internalNotes: rfq.internalNotes,
    purchaseRequest: {
      id: rfq.purchaseRequest.id,
      requestNumber: rfq.purchaseRequest.requestNumber,
      status: rfq.purchaseRequest.status as RfqDetail["purchaseRequest"]["status"],
    },
    items: rfq.items.map(toRfqItemView),
    suppliers: rfq.suppliers.map(toRfqSupplierView),
    createdAt: rfq.createdAt.toISOString(),
    sentAt: rfq.sentAt?.toISOString() ?? null,
    closedAt: rfq.closedAt?.toISOString() ?? null,
    cancelledAt: rfq.cancelledAt?.toISOString() ?? null,
    cancelReason: rfq.cancelReason,
  };
}

function toRfqSummary(rfq: RfqListRow): RfqSummary {
  return {
    id: rfq.id,
    rfqNumber: rfq.rfqNumber,
    status: rfq.status as RfqSummary["status"],
    deadline: rfq.deadline?.toISOString() ?? null,
    purchaseRequest: { id: rfq.purchaseRequest.id, requestNumber: rfq.purchaseRequest.requestNumber },
    itemCount: rfq._count.items,
    supplierCount: rfq._count.suppliers,
    createdAt: rfq.createdAt.toISOString(),
    sentAt: rfq.sentAt?.toISOString() ?? null,
  };
}
