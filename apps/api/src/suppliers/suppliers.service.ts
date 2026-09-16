import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@top/database";
import type { createTenantSafePrismaClient } from "@top/database";
import type { TenantTransactionClient } from "../database/database.module";
import type {
  AddSupplierCapabilityInput,
  CreateSupplierContactInput,
  CreateSupplierInput,
  ListSuppliersQuery,
  UpdateSupplierContactInput,
  UpdateSupplierInput,
  UpdateSupplierRatingInput,
  UpdateSupplierStatusInput,
} from "@top/validation";
import type { SupplierCapabilityView, SupplierContactView, SupplierDetail, SupplierListResult, SupplierSummary } from "@top/types";
import { TENANT_PRISMA } from "../database/database.module";
import { AuditService } from "../common/audit/audit.service";
import { computePayloadHash } from "../common/canonical-hash.util";
import { ENTITY_SEQUENCE_TYPE, EntitySequenceService, SUPPLIER_SEQUENCE_YEAR } from "../common/entity-sequence/entity-sequence.service";
import { isRetryableTransactionError } from "../stock/transaction-conflict.util";

type TenantDb = ReturnType<typeof createTenantSafePrismaClient>;
type SupplierRow = Awaited<ReturnType<TenantDb["supplier"]["findFirstOrThrow"]>>;
type SupplierContactRow = Awaited<ReturnType<TenantDb["supplierContact"]["findFirstOrThrow"]>>;
interface SupplierWithRelations extends SupplierRow {
  contacts: SupplierContactRow[];
  categories: { categoryId: string; category: { id: string; name: string } }[];
}

const MAX_TRANSACTION_RETRIES = 1;

/**
 * Internal marker only — same shape/reasoning as PurchaseRequestsService's
 * own IdempotencyConflictMarker: signals specifically "the header insert
 * hit the idempotency partial unique index," never allowed to escape this
 * file uncaught.
 */
class IdempotencyConflictMarker extends Error {}

/** Trim + strip whitespace/hyphens + uppercase; an all-stripped result becomes NULL, never empty string (Revision 1 R6/R5). Never restricts to numeric-only — foreign tax IDs may contain letters. */
function normalizeTin(tin: string | null | undefined): string | null {
  if (!tin) return null;
  const stripped = tin.replace(/[\s-]/g, "").toUpperCase();
  return stripped.length > 0 ? stripped : null;
}

/**
 * Distinguishes which unique constraint a P2002 on `supplier.create()`
 * actually hit, by matching the known index names against `err.meta.target`
 * (Prisma reports this as either a field-name array or the raw Postgres
 * index name, depending on whether the index is schema-declared or hand-
 * added SQL — both forms contain these substrings, since the migration
 * names every index after its columns verbatim). This matters because,
 * unlike PurchaseRequest's requestNumber collision (pure concurrency
 * artifact, safe to retry), a duplicate normalizedTin is a REAL business
 * rejection that must never be silently retried or misreported as an
 * idempotency conflict (Revision 1 R7/R8).
 */
function violatedConstraint(err: Prisma.PrismaClientKnownRequestError): string {
  const target = err.meta?.target;
  return Array.isArray(target) ? target.join(",") : String(target ?? "");
}

/**
 * Final Hardening fix: hashes the create payload used for idempotency
 * replay comparison. Two changes from the original `computePayloadHash(input)`
 * call: (1) `idempotencyKey` itself is excluded — matches
 * PurchaseRequestsService's `computeCreateHash` semantics ("the key is
 * metadata about the request, not part of its business intent"), not
 * StockMovementsService's (left unchanged, out of scope here); (2) `tin` is
 * hashed in its CANONICAL normalized form, not the raw trimmed business
 * value, so two differently-formatted-but-equal TINs (e.g. "AB-1234" vs
 * "AB 1234") replay the same Supplier instead of false-conflicting.
 * companyName/email need no extra normalization here — ZodValidationPipe
 * already returns the schema's PARSED output (trim/toLowerCase already
 * applied) before this ever runs, not the raw request body.
 */
function computeCreateHash(input: CreateSupplierInput): string {
  const { idempotencyKey: _idempotencyKey, tin, ...rest } = input;
  return computePayloadHash({ ...rest, tin: normalizeTin(tin) });
}

function toSummary(row: SupplierRow): SupplierSummary {
  return {
    id: row.id,
    supplierCode: row.supplierCode,
    companyName: row.companyName,
    legalName: row.legalName,
    tin: row.tin,
    countryCode: row.countryCode,
    status: row.status,
    rating: row.rating?.toString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toContactView(row: SupplierContactRow): SupplierContactView {
  return {
    id: row.id,
    supplierId: row.supplierId,
    fullName: row.fullName,
    position: row.position,
    phone: row.phone,
    email: row.email,
    telegram: row.telegram,
    isPrimary: row.isPrimary,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDetail(row: SupplierWithRelations): SupplierDetail {
  return {
    id: row.id,
    supplierCode: row.supplierCode,
    companyName: row.companyName,
    legalName: row.legalName,
    tin: row.tin,
    countryCode: row.countryCode,
    address: row.address,
    phone: row.phone,
    email: row.email,
    website: row.website,
    rating: row.rating?.toString() ?? null,
    status: row.status,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    contacts: row.contacts.map(toContactView),
    categories: row.categories.map((c): SupplierCapabilityView => ({ categoryId: c.categoryId, categoryName: c.category.name })),
  };
}

@Injectable()
export class SuppliersService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly sequences: EntitySequenceService
  ) {}

  // ────────────────────────────────────────────────────────────
  // READ
  // ────────────────────────────────────────────────────────────

  async list(organizationId: string, query: ListSuppliersQuery): Promise<SupplierListResult> {
    // Audit fix (B/C integration audit §26): comparing the RAW search term
    // against `normalizedTin` can never match a formatted query like
    // "123-456-789" — normalizedTin never contains separators. Normalizing
    // the search term the SAME way TIN itself is normalized, and comparing
    // THAT against normalizedTin, is what actually delivers the
    // architecture's own stated intent ("when query looks TIN-like,
    // compare both tin and normalizedTin"). Only added when non-empty, so
    // an all-separator search term (e.g. "--") can't degrade into an
    // empty-string `contains` that would match every row.
    const normalizedSearchTin = normalizeTin(query.search);

    const where: Prisma.SupplierWhereInput = {
      organizationId,
      // Default list excludes ARCHIVED unless a status filter is explicitly
      // requested (Revision 1 §28) — a plain `status` filter overrides this.
      status: query.status ?? { not: "ARCHIVED" },
      ...(query.countryCode ? { countryCode: query.countryCode } : {}),
      ...(query.categoryId ? { categories: { some: { categoryId: query.categoryId } } } : {}),
      ...(query.search
        ? {
            OR: [
              { supplierCode: { contains: query.search, mode: Prisma.QueryMode.insensitive } },
              { companyName: { contains: query.search, mode: Prisma.QueryMode.insensitive } },
              { legalName: { contains: query.search, mode: Prisma.QueryMode.insensitive } },
              { tin: { contains: query.search, mode: Prisma.QueryMode.insensitive } },
              { email: { contains: query.search, mode: Prisma.QueryMode.insensitive } },
              { phone: { contains: query.search, mode: Prisma.QueryMode.insensitive } },
              ...(normalizedSearchTin ? [{ normalizedTin: { contains: normalizedSearchTin, mode: Prisma.QueryMode.insensitive } }] : []),
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.db.supplier.findMany({
        where,
        // Deterministic pagination (Revision 1 §28) — not createdAt desc
        // like PurchaseRequest's workflow-queue framing; this is alphabetic
        // master-data browsing.
        orderBy: [{ companyName: "asc" }, { supplierCode: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.supplier.count({ where }),
    ]);

    return { items: items.map(toSummary), total, page: query.page, pageSize: query.pageSize };
  }

  async get(organizationId: string, id: string): Promise<SupplierDetail> {
    const supplier = await this.db.supplier.findFirst({
      where: { id, organizationId },
      include: {
        // Final Hardening fix: active-primary -> other-active -> archived.
        // `active desc` alone would already group archived contacts last;
        // `isPrimary desc` then ranks the primary first within the active
        // group. Archived contacts are deliberately NOT filtered out here —
        // they remain visible historical data (Revision 1 §19/§21), never
        // auto-promoted, never hidden.
        contacts: { orderBy: [{ active: "desc" }, { isPrimary: "desc" }, { createdAt: "asc" }] },
        categories: { include: { category: true } },
      },
    });
    if (!supplier) throw new NotFoundException("Supplier not found");
    return toDetail(supplier as unknown as SupplierWithRelations);
  }

  // ────────────────────────────────────────────────────────────
  // CREATE
  // ────────────────────────────────────────────────────────────

  async create(organizationId: string, actorUserId: string, input: CreateSupplierInput): Promise<SupplierDetail> {
    const payloadHash = input.idempotencyKey ? computeCreateHash(input) : undefined;

    if (input.idempotencyKey) {
      const existing = await this.db.supplier.findFirst({ where: { organizationId, idempotencyKey: input.idempotencyKey } });
      if (existing) return this.resolveIdempotentReplay(organizationId, existing, payloadHash!);
    }

    const id = await this.attemptCreate(organizationId, actorUserId, input, payloadHash, MAX_TRANSACTION_RETRIES);
    return this.get(organizationId, id);
  }

  private async resolveIdempotentReplay(
    organizationId: string,
    existing: { id: string; payloadHash: string | null },
    payloadHash: string
  ): Promise<SupplierDetail> {
    if (existing.payloadHash !== payloadHash) {
      throw new ConflictException("idempotencyKey was already used with a different request payload");
    }
    return this.get(organizationId, existing.id);
  }

  private async attemptCreate(
    organizationId: string,
    actorUserId: string,
    input: CreateSupplierInput,
    payloadHash: string | undefined,
    retriesLeft: number
  ): Promise<string> {
    try {
      return await this.db.$transaction((tx) => this.executeCreate(tx, organizationId, actorUserId, input, payloadHash));
    } catch (err) {
      if (err instanceof IdempotencyConflictMarker) {
        if (!input.idempotencyKey) throw err; // unreachable — marker only thrown when a key was supplied
        const existing = await this.db.supplier.findFirst({ where: { organizationId, idempotencyKey: input.idempotencyKey } });
        if (existing) {
          const detail = await this.resolveIdempotentReplay(organizationId, existing, payloadHash!);
          return detail.id;
        }
        throw new ConflictException("Idempotency key conflict could not be resolved");
      }

      const isRaceOrDeadlock =
        isRetryableTransactionError(err) || (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002");
      if (isRaceOrDeadlock && retriesLeft > 0) {
        return this.attemptCreate(organizationId, actorUserId, input, payloadHash, retriesLeft - 1);
      }
      throw err;
    }
  }

  private async executeCreate(
    tx: TenantTransactionClient,
    organizationId: string,
    actorUserId: string,
    input: CreateSupplierInput,
    payloadHash: string | undefined
  ): Promise<string> {
    const sequenceValue = await this.sequences.nextValue(tx, organizationId, ENTITY_SEQUENCE_TYPE.SUPPLIER, SUPPLIER_SEQUENCE_YEAR);
    const supplierCode = `SUP-${String(sequenceValue).padStart(6, "0")}`;

    let supplier: SupplierRow;
    try {
      supplier = await tx.supplier.create({
        data: {
          organizationId,
          supplierCode,
          companyName: input.companyName,
          legalName: input.legalName ?? null,
          tin: input.tin ?? null,
          normalizedTin: normalizeTin(input.tin),
          countryCode: input.countryCode ?? null,
          address: input.address ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          website: input.website ?? null,
          notes: input.notes ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
          payloadHash: payloadHash ?? null,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const violated = violatedConstraint(err);
        if (violated.includes("idempotencyKey")) throw new IdempotencyConflictMarker();
        if (violated.includes("normalizedTin")) {
          throw new ConflictException("A supplier with this tax ID already exists in your organization");
        }
        // supplierCode race (or anything else unrecognized): rethrow so the
        // outer attempt() retry loop retries the whole transaction with a
        // fresh sequence read, same policy as PurchaseRequestsService.
      }
      throw err;
    }

    await this.audit.log(
      {
        organizationId,
        userId: actorUserId,
        action: "SUPPLIER_CREATED",
        entityType: "Supplier",
        entityId: supplier.id,
        newValue: { supplierCode, companyName: supplier.companyName },
      },
      tx
    );

    return supplier.id;
  }

  // ────────────────────────────────────────────────────────────
  // UPDATE (general master-data fields — never status/rating, Revision 1 R18/R24)
  // ────────────────────────────────────────────────────────────

  async update(organizationId: string, actorUserId: string, id: string, input: UpdateSupplierInput): Promise<SupplierDetail> {
    const existing = await this.db.supplier.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundException("Supplier not found");

    const data: Prisma.SupplierUncheckedUpdateInput = {};
    const oldValue: Record<string, unknown> = {};
    const newValue: Record<string, unknown> = {};

    const fields = ["companyName", "legalName", "tin", "countryCode", "address", "phone", "email", "website", "notes"] as const;
    for (const field of fields) {
      const nextVal = input[field];
      if (nextVal !== undefined && nextVal !== existing[field]) {
        (data as Record<string, unknown>)[field] = nextVal;
        oldValue[field] = existing[field];
        newValue[field] = nextVal;
        // Clearing tin (null) must clear normalizedTin too — normalizeTin(null) already returns null.
        if (field === "tin") data.normalizedTin = normalizeTin(nextVal as string | null);
      }
    }

    if (Object.keys(data).length === 0) return this.get(organizationId, id);

    // Final Hardening fix: mutation + audit now share ONE transaction — an
    // AuditLog write failure rolls the Supplier field change back too,
    // matching every other mutation in this service (was previously the
    // one place still doing mutation-then-audit-outside-transaction).
    try {
      await this.db.$transaction(async (tx) => {
        await tx.supplier.update({ where: { id }, data });
        await this.audit.log(
          {
            organizationId,
            userId: actorUserId,
            action: "SUPPLIER_UPDATED",
            entityType: "Supplier",
            entityId: id,
            oldValue,
            newValue,
          },
          tx
        );
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException("A supplier with this tax ID already exists in your organization");
      }
      throw err;
    }

    return this.get(organizationId, id);
  }

  // ────────────────────────────────────────────────────────────
  // STATUS / RATING — dedicated endpoints (Revision 1 R18/R23)
  // ────────────────────────────────────────────────────────────

  async updateStatus(organizationId: string, actorUserId: string, id: string, input: UpdateSupplierStatusInput): Promise<SupplierDetail> {
    const existing = await this.db.supplier.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundException("Supplier not found");

    // Same-status request: no-op 200, no duplicate audit row (Revision 1 §17).
    if (existing.status === input.status) return this.get(organizationId, id);

    // Final Hardening fix: same transaction-wraps-audit treatment as update().
    await this.db.$transaction(async (tx) => {
      await tx.supplier.update({ where: { id }, data: { status: input.status } });
      await this.audit.log(
        {
          organizationId,
          userId: actorUserId,
          action: "SUPPLIER_STATUS_CHANGED",
          entityType: "Supplier",
          entityId: id,
          oldValue: { status: existing.status },
          // `reason` is audit-context only, never a database column (Revision 1 R14).
          newValue: { status: input.status, ...(input.reason ? { reason: input.reason } : {}) },
        },
        tx
      );
    });

    return this.get(organizationId, id);
  }

  async updateRating(organizationId: string, actorUserId: string, id: string, input: UpdateSupplierRatingInput): Promise<SupplierDetail> {
    const existing = await this.db.supplier.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundException("Supplier not found");

    // Final Hardening fix: same transaction-wraps-audit treatment as update().
    await this.db.$transaction(async (tx) => {
      await tx.supplier.update({ where: { id }, data: { rating: input.rating } });
      await this.audit.log(
        {
          organizationId,
          userId: actorUserId,
          action: "SUPPLIER_RATING_CHANGED",
          entityType: "Supplier",
          entityId: id,
          oldValue: { rating: existing.rating?.toString() ?? null },
          newValue: { rating: input.rating },
        },
        tx
      );
    });

    return this.get(organizationId, id);
  }

  // ────────────────────────────────────────────────────────────
  // CONTACTS
  // ────────────────────────────────────────────────────────────

  async addContact(
    organizationId: string,
    actorUserId: string,
    supplierId: string,
    input: CreateSupplierContactInput
  ): Promise<SupplierContactView> {
    return this.db.$transaction(async (tx) => {
      await this.requireSupplierTx(tx, organizationId, supplierId);

      // Demote-then-promote inside the same transaction (Revision 1 R15/R19)
      // — the partial unique index makes a concurrent double-primary
      // structurally IMPOSSIBLE AT THE DATA LEVEL regardless of
      // interleaving (Postgres itself will never persist two active
      // primaries for one supplier). It does NOT by itself prevent the
      // LOSING concurrent request from surfacing a raw unique-violation —
      // that still has to be caught explicitly and translated to a clean
      // 409 (audit fix, B/C integration audit §20: caught by a real
      // concurrency test that previously observed a raw 500 here).
      if (input.isPrimary) {
        await tx.supplierContact.updateMany({ where: { supplierId, isPrimary: true, active: true }, data: { isPrimary: false } });
      }

      let contact: SupplierContactRow;
      try {
        contact = await tx.supplierContact.create({
          data: {
            supplierId,
            fullName: input.fullName,
            position: input.position ?? null,
            phone: input.phone ?? null,
            email: input.email ?? null,
            telegram: input.telegram ?? null,
            isPrimary: input.isPrimary ?? false,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          throw new ConflictException("Another contact was just set as primary for this supplier — please retry");
        }
        throw err;
      }

      await this.audit.log(
        {
          organizationId,
          userId: actorUserId,
          action: "SUPPLIER_CONTACT_ADDED",
          entityType: "SupplierContact",
          entityId: contact.id,
          newValue: { supplierId, fullName: contact.fullName, isPrimary: contact.isPrimary },
        },
        tx
      );

      return toContactView(contact);
    });
  }

  async updateContact(
    organizationId: string,
    actorUserId: string,
    supplierId: string,
    contactId: string,
    input: UpdateSupplierContactInput
  ): Promise<SupplierContactView> {
    return this.db.$transaction(async (tx) => {
      await this.requireSupplierTx(tx, organizationId, supplierId);
      const existing = await tx.supplierContact.findFirst({ where: { id: contactId, supplierId } });
      if (!existing) throw new NotFoundException("Supplier contact not found");

      if (input.isPrimary === true && !existing.isPrimary) {
        await tx.supplierContact.updateMany({ where: { supplierId, isPrimary: true, active: true }, data: { isPrimary: false } });
      }

      const data: Prisma.SupplierContactUncheckedUpdateInput = {};
      const oldValue: Record<string, unknown> = {};
      const newValue: Record<string, unknown> = {};
      const fields = ["fullName", "position", "phone", "email", "telegram", "isPrimary"] as const;
      for (const field of fields) {
        const nextVal = input[field];
        if (nextVal !== undefined && nextVal !== existing[field]) {
          (data as Record<string, unknown>)[field] = nextVal;
          oldValue[field] = existing[field];
          newValue[field] = nextVal;
        }
      }

      let contact: SupplierContactRow = existing;
      if (Object.keys(data).length > 0) {
        try {
          contact = await tx.supplierContact.update({ where: { id: contactId }, data });
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
            throw new ConflictException("Another contact was just set as primary for this supplier — please retry");
          }
          throw err;
        }

        await this.audit.log(
          {
            organizationId,
            userId: actorUserId,
            action: "SUPPLIER_CONTACT_UPDATED",
            entityType: "SupplierContact",
            entityId: contactId,
            oldValue: { ...oldValue, supplierId },
            newValue,
          },
          tx
        );
      }

      return toContactView(contact);
    });
  }

  async archiveContact(organizationId: string, actorUserId: string, supplierId: string, contactId: string): Promise<SupplierContactView> {
    return this.db.$transaction(async (tx) => {
      await this.requireSupplierTx(tx, organizationId, supplierId);
      const existing = await tx.supplierContact.findFirst({ where: { id: contactId, supplierId } });
      if (!existing) throw new NotFoundException("Supplier contact not found");

      // Final Hardening fix: repeat archive is now an idempotent no-op —
      // 200, no second SUPPLIER_CONTACT_ARCHIVED audit row — matching the
      // no-op-means-no-audit discipline already established for
      // updateStatus()/update().
      if (!existing.active) return toContactView(existing);

      // Clearing isPrimary too — an archived contact should never remain
      // conceptually "primary." Zero primary contacts is an accepted
      // temporary state; no auto-promotion of another one (Revision 1 §19).
      const contact = await tx.supplierContact.update({ where: { id: contactId }, data: { active: false, isPrimary: false } });

      await this.audit.log(
        {
          organizationId,
          userId: actorUserId,
          action: "SUPPLIER_CONTACT_ARCHIVED",
          entityType: "SupplierContact",
          entityId: contactId,
          oldValue: { supplierId, active: true },
        },
        tx
      );

      return toContactView(contact);
    });
  }

  // ────────────────────────────────────────────────────────────
  // CAPABILITIES
  // ────────────────────────────────────────────────────────────

  async addCapability(
    organizationId: string,
    actorUserId: string,
    supplierId: string,
    input: AddSupplierCapabilityInput
  ): Promise<SupplierCapabilityView> {
    return this.db.$transaction(async (tx) => {
      await this.requireSupplierTx(tx, organizationId, supplierId);
      // Both parent AND category are tenant-checked inside this same
      // transaction (Revision 1 R21) — a cross-org categoryId 404s exactly
      // like a nonexistent one, never leaking another org's category IDs.
      const category = await tx.category.findFirst({ where: { id: input.categoryId, organizationId } });
      if (!category) throw new NotFoundException("Category not found");
      // Final Hardening fix: a NEW capability assignment requires an active
      // Category — an already-existing relation is left untouched if the
      // Category later becomes inactive (this check only runs here, on
      // ADD, never on read/remove).
      if (!category.active) throw new BadRequestException("Cannot assign an inactive category as a supplier capability");

      try {
        await tx.supplierCategory.create({ data: { supplierId, categoryId: input.categoryId } });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          throw new ConflictException("This capability is already assigned to the supplier");
        }
        throw err;
      }

      await this.audit.log(
        {
          organizationId,
          userId: actorUserId,
          action: "SUPPLIER_CAPABILITY_ADDED",
          entityType: "Supplier",
          entityId: supplierId,
          newValue: { categoryId: input.categoryId },
        },
        tx
      );

      return { categoryId: category.id, categoryName: category.name };
    });
  }

  async removeCapability(organizationId: string, actorUserId: string, supplierId: string, categoryId: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await this.requireSupplierTx(tx, organizationId, supplierId);
      const existing = await tx.supplierCategory.findFirst({ where: { supplierId, categoryId } });
      if (!existing) throw new NotFoundException("Capability not found");

      await tx.supplierCategory.delete({ where: { supplierId_categoryId: { supplierId, categoryId } } });

      await this.audit.log(
        {
          organizationId,
          userId: actorUserId,
          action: "SUPPLIER_CAPABILITY_REMOVED",
          entityType: "Supplier",
          entityId: supplierId,
          oldValue: { categoryId },
        },
        tx
      );
    });
  }

  private async requireSupplierTx(tx: TenantTransactionClient, organizationId: string, id: string): Promise<void> {
    const supplier = await tx.supplier.findFirst({ where: { id, organizationId } });
    if (!supplier) throw new NotFoundException("Supplier not found");
  }
}
