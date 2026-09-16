import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@top/database";
import type { createTenantSafePrismaClient, UserRole } from "@top/database";
import type { TenantTransactionClient } from "../database/database.module";
import type {
  AssignPurchaseRequestInput,
  CreatePurchaseRequestInput,
  ListPurchaseRequestsQuery,
  PurchaseRequestItemInput,
  RejectPurchaseRequestInput,
  UpdatePurchaseRequestInput,
  UpdatePurchaseRequestItemInput,
} from "@top/validation";
import type {
  PurchaseRequestApprovalStepView,
  PurchaseRequestApprovalView,
  PurchaseRequestItemSummary,
  PurchaseRequestListItem,
  PurchaseRequestListResult,
  PurchaseRequestSummary,
} from "@top/types";
import { TENANT_PRISMA } from "../database/database.module";
import { AuditService } from "../common/audit/audit.service";
import { DomainEventsService } from "../realtime/domain-events.service";
import { computePayloadHash } from "../common/canonical-hash.util";
import { EntitySequenceService, ENTITY_SEQUENCE_TYPE } from "../common/entity-sequence/entity-sequence.service";
import { formatPurchaseRequestNumber } from "../common/entity-sequence/purchase-request-number.util";
import { isRetryableTransactionError } from "../stock/transaction-conflict.util";

type TenantDb = ReturnType<typeof createTenantSafePrismaClient>;
type PurchaseRequestRow = Awaited<ReturnType<TenantDb["purchaseRequest"]["findFirstOrThrow"]>>;
type PurchaseRequestItemRow = Awaited<ReturnType<TenantDb["purchaseRequestItem"]["findFirstOrThrow"]>>;
type ApprovalInstanceRow = Awaited<ReturnType<TenantDb["approvalInstance"]["findFirstOrThrow"]>>;
type ApprovalStepInstanceRow = Awaited<ReturnType<TenantDb["approvalStepInstance"]["findFirstOrThrow"]>>;
type ApprovalInstanceWithSteps = ApprovalInstanceRow & { steps: ApprovalStepInstanceRow[] };
type PurchaseRequestWithApproval = PurchaseRequestRow & { items: PurchaseRequestItemRow[]; approvalInstance: ApprovalInstanceWithSteps | null };
type PurchaseRequestListRow = PurchaseRequestRow & { _count: { items: number } };

/** Full org visibility (no ownership scoping) — Architecture Gate RBAC matrix. */
const ORG_WIDE_ROLES: UserRole[] = ["ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST"];

/** Bounded retry of the WHOLE transaction boundary only — same constant/reasoning as StockMovementsService (M2.5). */
const MAX_TRANSACTION_RETRIES = 1;

/** Phase E §27: SUBMITTED is kept in this list for forward compatibility even though M3.1's synchronous submit() never leaves a PR resting in it (see submit()'s own doc comment). */
const ASSIGNABLE_STATUSES: PurchaseRequestRow["status"][] = ["SUBMITTED", "UNDER_APPROVAL", "APPROVED"];

/** Eligible assign-buyer target roles (§26) — ADMIN is deliberately never a valid target, only a valid actor. */
const ELIGIBLE_BUYER_ROLES: UserRole[] = ["PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST"];

/**
 * Internal marker only — never extends HttpException, never allowed to
 * escape this file uncaught. Signals specifically "the header insert hit
 * the idempotency partial unique index" — same shape/reasoning as
 * StockMovementsService's own marker (M2.5 Phase F), duplicated locally
 * rather than shared: it's a one-line class with no reusable behavior.
 */
class IdempotencyConflictMarker extends Error {}

/**
 * M3.1 Phase D. Server-side visibility scope — applied identically to
 * list/detail/mutation lookups so "cannot read/edit a PR by guessing ID" is
 * enforced by the WHERE clause itself, not a separate ownership branch (a
 * non-owner EMPLOYEE's lookup simply matches zero rows, 404s exactly like a
 * cross-tenant lookup already does — no information about the PR's
 * existence leaks either way). APPROVER's clause is deliberately always
 * unsatisfiable in Phase D (no ApprovalStepInstance rows exist yet — Phase D
 * §31) — this is the documented, accepted "APPROVER sees nothing yet" state,
 * not a bug; Phase E's submit() flow is what starts populating steps.
 */
function visibilityWhere(organizationId: string, actorUserId: string, actorRole: UserRole): Prisma.PurchaseRequestWhereInput {
  if (ORG_WIDE_ROLES.includes(actorRole)) {
    return { organizationId };
  }
  if (actorRole === "APPROVER") {
    return { organizationId, approvalInstance: { steps: { some: { assignedUserId: actorUserId } } } };
  }
  // EMPLOYEE (and any other non-listed role, defensively — SUPPLIER never
  // reaches here at all, excluded by the controller's own @Roles()).
  return { organizationId, requesterId: actorUserId };
}

@Injectable()
export class PurchaseRequestsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly sequences: EntitySequenceService,
    private readonly events: DomainEventsService
  ) {}

  // ────────────────────────────────────────────────────────────
  // CREATE
  // ────────────────────────────────────────────────────────────

  async create(
    organizationId: string,
    actorUserId: string,
    input: CreatePurchaseRequestInput
  ): Promise<PurchaseRequestSummary> {
    // RolesGuard has already enforced the coarse allowed-role set
    // (ADMIN/PROCUREMENT_MANAGER/PROCUREMENT_SPECIALIST/EMPLOYEE) before this
    // method is ever called — unlike StockMovement, no sub-type varies that
    // requirement further, so there is nothing left for a service-level
    // check to add. Authorization is therefore already complete before the
    // idempotency lookup below runs (Phase D §10's ordering requirement is
    // satisfied structurally by Nest's guard-then-handler execution order).
    const payloadHash = input.idempotencyKey ? computeCreateHash(input) : undefined;

    if (input.idempotencyKey) {
      const existing = await this.db.purchaseRequest.findFirst({ where: { organizationId, idempotencyKey: input.idempotencyKey } });
      if (existing) {
        return this.resolveIdempotentReplay(organizationId, existing, payloadHash!);
      }
    }

    const id = await this.attempt(organizationId, actorUserId, input, payloadHash, MAX_TRANSACTION_RETRIES);
    return this.loadSummary(organizationId, id);
  }

  private async resolveIdempotentReplay(
    organizationId: string,
    existing: { id: string; payloadHash: string | null },
    payloadHash: string
  ): Promise<PurchaseRequestSummary> {
    if (existing.payloadHash !== payloadHash) {
      throw new ConflictException("idempotencyKey was already used with a different request payload");
    }
    return this.loadSummary(organizationId, existing.id);
  }

  private async attempt(
    organizationId: string,
    actorUserId: string,
    input: CreatePurchaseRequestInput,
    payloadHash: string | undefined,
    retriesLeft: number
  ): Promise<string> {
    try {
      return await this.db.$transaction((tx) => this.executeCreate(tx, organizationId, actorUserId, input, payloadHash));
    } catch (err) {
      if (err instanceof IdempotencyConflictMarker) {
        if (!input.idempotencyKey) throw err; // unreachable — marker only thrown when a key was supplied
        const existing = await this.db.purchaseRequest.findFirst({ where: { organizationId, idempotencyKey: input.idempotencyKey } });
        if (existing) {
          const summary = await this.resolveIdempotentReplay(organizationId, existing, payloadHash!);
          return summary.id;
        }
        throw new ConflictException("Idempotency key conflict could not be resolved");
      }

      // Distinguishing EntitySequence's own P2002 (first-row race — Phase C)
      // from the PurchaseRequest idempotency P2002 above: the idempotency
      // one is caught immediately at ITS OWN origin (inside executeCreate,
      // right after the purchaseRequest.create() call) and translated to
      // the marker above; anything else reaching here — including
      // EntitySequence's create() P2002 — was never caught closer to its
      // origin, so it is, by construction, never the idempotency case. Same
      // OR-condition retry policy as StockMovementsService.attempt().
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
    input: CreatePurchaseRequestInput,
    payloadHash: string | undefined
  ): Promise<string> {
    if (input.departmentId) await this.requireDepartmentTx(tx, organizationId, input.departmentId);
    if (input.categoryId) await this.requireCategoryTx(tx, organizationId, input.categoryId);

    const year = new Date().getUTCFullYear();
    const sequenceValue = await this.sequences.nextValue(tx, organizationId, ENTITY_SEQUENCE_TYPE.PURCHASE_REQUEST, year);
    const requestNumber = formatPurchaseRequestNumber(year, sequenceValue);

    // Header inserted FIRST, before items — a duplicate idempotencyKey fails
    // fast here, before any item work runs (same discipline as
    // StockMovementsService.executeMovement).
    let purchaseRequest: PurchaseRequestRow;
    try {
      purchaseRequest = await tx.purchaseRequest.create({
        data: {
          organizationId,
          requestNumber,
          requesterId: actorUserId,
          departmentId: input.departmentId ?? null,
          categoryId: input.categoryId ?? null,
          priority: input.priority ?? "NORMAL",
          requiredDate: input.requiredDate ? new Date(input.requiredDate) : null,
          reason: input.reason ?? null,
          estimatedBudget: input.estimatedBudget ?? null,
          currency: input.currency ?? undefined,
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

    for (const item of input.items) {
      const itemData = await this.resolveItemData(tx, organizationId, item);
      await tx.purchaseRequestItem.create({ data: { purchaseRequestId: purchaseRequest.id, ...itemData } });
    }

    await this.audit.log(
      {
        organizationId,
        userId: actorUserId,
        action: "PURCHASE_REQUEST_CREATED",
        entityType: "PurchaseRequest",
        entityId: purchaseRequest.id,
        newValue: { requestNumber, itemCount: input.items.length },
      },
      tx
    );

    return purchaseRequest.id;
  }

  // ────────────────────────────────────────────────────────────
  // READ
  // ────────────────────────────────────────────────────────────

  async list(
    organizationId: string,
    actorUserId: string,
    actorRole: UserRole,
    query: ListPurchaseRequestsQuery
  ): Promise<PurchaseRequestListResult> {
    // AND, never a flat spread merge: a flat merge would let a client-
    // supplied filter (e.g. ?requesterUserId=<someone-else>) silently
    // OVERWRITE the EMPLOYEE ownership constraint from visibilityWhere
    // (later object-spread keys win) — AND keeps both constraints in force
    // simultaneously, so a mismatched filter just yields zero rows, never a
    // leak.
    const where: Prisma.PurchaseRequestWhereInput = {
      AND: [
        visibilityWhere(organizationId, actorUserId, actorRole),
        {
          ...(query.status ? { status: query.status } : {}),
          ...(query.requesterUserId ? { requesterId: query.requesterUserId } : {}),
          ...(query.assignedBuyerUserId ? { assignedBuyerUserId: query.assignedBuyerUserId } : {}),
          ...(query.priority ? { priority: query.priority } : {}),
          ...(query.requestNumber ? { requestNumber: query.requestNumber } : {}),
          ...(query.requiredDate ? { requiredDate: new Date(query.requiredDate) } : {}),
          ...(query.createdAtFrom || query.createdAtTo
            ? {
                createdAt: {
                  ...(query.createdAtFrom ? { gte: new Date(query.createdAtFrom) } : {}),
                  ...(query.createdAtTo ? { lte: new Date(query.createdAtTo) } : {}),
                },
              }
            : {}),
        },
      ],
    };

    const [rows, total] = await Promise.all([
      this.db.purchaseRequest.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { _count: { select: { items: true } } },
      }),
      this.db.purchaseRequest.count({ where }),
    ]);

    return { items: (rows as PurchaseRequestListRow[]).map(toListItem), total, page: query.page, pageSize: query.pageSize };
  }

  async get(organizationId: string, actorUserId: string, actorRole: UserRole, id: string): Promise<PurchaseRequestSummary> {
    const pr = (await this.db.purchaseRequest.findFirst({
      where: { id, ...visibilityWhere(organizationId, actorUserId, actorRole) },
      include: { items: true, approvalInstance: { include: { steps: true } } },
    })) as PurchaseRequestWithApproval | null;
    if (!pr) throw new NotFoundException("Purchase request not found");
    return toSummary(pr);
  }

  private async loadSummary(organizationId: string, id: string): Promise<PurchaseRequestSummary> {
    const pr = (await this.db.purchaseRequest.findFirst({
      where: { id, organizationId },
      include: { items: true, approvalInstance: { include: { steps: true } } },
    })) as PurchaseRequestWithApproval | null;
    if (!pr) throw new NotFoundException("Purchase request not found");
    return toSummary(pr);
  }

  /**
   * Phase E: shared tx-scoped summary loader for the action endpoints
   * (submit/approve/reject/cancel/assign) — each ends its own transaction by
   * re-reading the row it just mutated, rather than hand-assembling a
   * response from partial local state.
   */
  private async loadSummaryTx(tx: TenantTransactionClient, organizationId: string, id: string): Promise<PurchaseRequestSummary> {
    const pr = (await tx.purchaseRequest.findFirstOrThrow({
      where: { id, organizationId },
      include: { items: true, approvalInstance: { include: { steps: true } } },
    })) as PurchaseRequestWithApproval;
    return toSummary(pr);
  }

  // ────────────────────────────────────────────────────────────
  // HEADER PATCH (DRAFT only)
  // ────────────────────────────────────────────────────────────

  async update(
    organizationId: string,
    actorUserId: string,
    actorRole: UserRole,
    id: string,
    input: UpdatePurchaseRequestInput
  ): Promise<PurchaseRequestSummary> {
    return this.db.$transaction(async (tx) => {
      const existing = await this.requireEditableDraftTx(tx, organizationId, actorUserId, actorRole, id);

      const data: Prisma.PurchaseRequestUncheckedUpdateInput = {};
      const oldValue: Record<string, unknown> = {};
      const newValue: Record<string, unknown> = {};

      if (input.departmentId !== undefined && input.departmentId !== existing.departmentId) {
        await this.requireDepartmentTx(tx, organizationId, input.departmentId);
        data.departmentId = input.departmentId;
        oldValue.departmentId = existing.departmentId;
        newValue.departmentId = input.departmentId;
      }
      if (input.categoryId !== undefined && input.categoryId !== existing.categoryId) {
        await this.requireCategoryTx(tx, organizationId, input.categoryId);
        data.categoryId = input.categoryId;
        oldValue.categoryId = existing.categoryId;
        newValue.categoryId = input.categoryId;
      }
      if (input.priority !== undefined && input.priority !== existing.priority) {
        data.priority = input.priority;
        oldValue.priority = existing.priority;
        newValue.priority = input.priority;
      }
      if (input.requiredDate !== undefined) {
        const nextDate = new Date(input.requiredDate);
        if (existing.requiredDate?.getTime() !== nextDate.getTime()) {
          data.requiredDate = nextDate;
          oldValue.requiredDate = existing.requiredDate?.toISOString() ?? null;
          newValue.requiredDate = nextDate.toISOString();
        }
      }
      if (input.reason !== undefined && input.reason !== existing.reason) {
        data.reason = input.reason;
        oldValue.reason = existing.reason;
        newValue.reason = input.reason;
      }
      if (input.estimatedBudget !== undefined) {
        const nextBudget = new Prisma.Decimal(input.estimatedBudget);
        if (!existing.estimatedBudget || !nextBudget.equals(existing.estimatedBudget)) {
          data.estimatedBudget = input.estimatedBudget;
          oldValue.estimatedBudget = existing.estimatedBudget?.toString() ?? null;
          newValue.estimatedBudget = input.estimatedBudget;
        }
      }
      if (input.currency !== undefined && input.currency !== existing.currency) {
        data.currency = input.currency;
        oldValue.currency = existing.currency;
        newValue.currency = input.currency;
      }

      if (Object.keys(data).length === 0) {
        // No-op PATCH: return the existing PR successfully, write no audit —
        // never fabricate history for a change that never happened (§18).
        const unchanged = (await tx.purchaseRequest.findFirstOrThrow({
          where: { id },
          include: { items: true, approvalInstance: { include: { steps: true } } },
        })) as PurchaseRequestWithApproval;
        return toSummary(unchanged);
      }

      const updated = (await tx.purchaseRequest.update({
        where: { id },
        data,
        include: { items: true, approvalInstance: { include: { steps: true } } },
      })) as PurchaseRequestWithApproval;

      await this.audit.log(
        { organizationId, userId: actorUserId, action: "PURCHASE_REQUEST_UPDATED", entityType: "PurchaseRequest", entityId: id, oldValue, newValue },
        tx
      );

      return toSummary(updated);
    });
  }

  // ────────────────────────────────────────────────────────────
  // ITEMS (DRAFT only)
  // ────────────────────────────────────────────────────────────

  async addItem(
    organizationId: string,
    actorUserId: string,
    actorRole: UserRole,
    purchaseRequestId: string,
    input: PurchaseRequestItemInput
  ): Promise<PurchaseRequestItemSummary> {
    return this.db.$transaction(async (tx) => {
      const pr = await this.requireEditableDraftTx(tx, organizationId, actorUserId, actorRole, purchaseRequestId);
      const itemData = await this.resolveItemData(tx, organizationId, input);
      const item = await tx.purchaseRequestItem.create({ data: { purchaseRequestId: pr.id, ...itemData } });

      await this.audit.log(
        {
          organizationId,
          userId: actorUserId,
          action: "PURCHASE_REQUEST_ITEM_ADDED",
          entityType: "PurchaseRequestItem",
          entityId: item.id,
          newValue: { purchaseRequestId: pr.id, itemName: item.itemName, productId: item.productId, quantity: item.quantity.toString(), uomCode: item.uomCode },
        },
        tx
      );

      return toItemSummary(item);
    });
  }

  async updateItem(
    organizationId: string,
    actorUserId: string,
    actorRole: UserRole,
    purchaseRequestId: string,
    itemId: string,
    input: UpdatePurchaseRequestItemInput
  ): Promise<PurchaseRequestItemSummary> {
    return this.db.$transaction(async (tx) => {
      const pr = await this.requireEditableDraftTx(tx, organizationId, actorUserId, actorRole, purchaseRequestId);
      const existing = await this.requireItemTx(tx, pr.id, itemId);

      const data: Prisma.PurchaseRequestItemUncheckedUpdateInput = {};
      const oldValue: Record<string, unknown> = {};
      const newValue: Record<string, unknown> = {};

      if (input.quantity !== undefined) {
        const nextQty = new Prisma.Decimal(input.quantity);
        if (!nextQty.equals(existing.quantity)) {
          data.quantity = input.quantity;
          oldValue.quantity = existing.quantity.toString();
          newValue.quantity = input.quantity;
        }
      }
      if (input.uomCode !== undefined && input.uomCode !== existing.uomCode) {
        data.uomCode = input.uomCode;
        oldValue.uomCode = existing.uomCode;
        newValue.uomCode = input.uomCode;
      }
      if (input.description !== undefined && input.description !== existing.description) {
        data.description = input.description;
        oldValue.description = existing.description;
        newValue.description = input.description;
      }
      if (input.technicalSpec !== undefined) {
        const changed = JSON.stringify(input.technicalSpec) !== JSON.stringify(existing.technicalSpec ?? null);
        if (changed) {
          data.technicalSpec = input.technicalSpec as Prisma.InputJsonValue;
          oldValue.technicalSpec = existing.technicalSpec;
          newValue.technicalSpec = input.technicalSpec;
        }
      }
      if (input.requiredDate !== undefined) {
        const nextDate = new Date(input.requiredDate);
        if (existing.requiredDate?.getTime() !== nextDate.getTime()) {
          data.requiredDate = nextDate;
          oldValue.requiredDate = existing.requiredDate?.toISOString() ?? null;
          newValue.requiredDate = nextDate.toISOString();
        }
      }
      if (input.notes !== undefined && input.notes !== existing.notes) {
        data.notes = input.notes;
        oldValue.notes = existing.notes;
        newValue.notes = input.notes;
      }

      if (Object.keys(data).length === 0) {
        return toItemSummary(existing);
      }

      const updated = await tx.purchaseRequestItem.update({ where: { id: itemId }, data });

      await this.audit.log(
        {
          organizationId,
          userId: actorUserId,
          action: "PURCHASE_REQUEST_ITEM_UPDATED",
          entityType: "PurchaseRequestItem",
          entityId: itemId,
          oldValue: { ...oldValue, purchaseRequestId: pr.id },
          newValue,
        },
        tx
      );

      return toItemSummary(updated);
    });
  }

  async removeItem(organizationId: string, actorUserId: string, actorRole: UserRole, purchaseRequestId: string, itemId: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const pr = await this.requireEditableDraftTx(tx, organizationId, actorUserId, actorRole, purchaseRequestId);
      const existing = await this.requireItemTx(tx, pr.id, itemId);

      // No "last item" restriction in Phase D — a DRAFT may temporarily hold
      // zero items while the requester edits (delete-then-add UX); Phase E's
      // submit() is where "at least one item" becomes a real gate again.
      await tx.purchaseRequestItem.delete({ where: { id: itemId } });

      await this.audit.log(
        {
          organizationId,
          userId: actorUserId,
          action: "PURCHASE_REQUEST_ITEM_REMOVED",
          entityType: "PurchaseRequestItem",
          entityId: itemId,
          oldValue: {
            purchaseRequestId: pr.id,
            itemName: existing.itemName,
            productId: existing.productId,
            quantity: existing.quantity.toString(),
            uomCode: existing.uomCode,
          },
        },
        tx
      );
    });
  }

  // ────────────────────────────────────────────────────────────
  // WORKFLOW (Phase E) — submit / approve / reject / cancel / assign
  // ────────────────────────────────────────────────────────────

  /**
   * DRAFT -> UNDER_APPROVAL, creating the single-step ApprovalInstance.
   * Externally the PR jumps straight from DRAFT to UNDER_APPROVAL — SUBMITTED
   * is NOT written as a separate, independently-committed intermediate row
   * (§3): no external transaction could ever observe it inside this same
   * $transaction anyway, and writing it merely for appearance would be a
   * pointless extra UPDATE. SUBMITTED remains a real, valid enum value —
   * `submittedAt` and the PURCHASE_REQUEST_SUBMITTED audit row are its
   * historical trace — reserved for a FUTURE durable/asynchronous routing
   * step (e.g. a queue-backed approval-preparation stage) that would need to
   * rest there for real, not built by M3.1.
   */
  async submit(organizationId: string, actorUserId: string, actorRole: UserRole, id: string): Promise<PurchaseRequestSummary> {
    const summary = await this.db.$transaction(async (tx) => {
      const pr = await tx.purchaseRequest.findFirst({
        where: { id, ...visibilityWhere(organizationId, actorUserId, actorRole) },
        include: { items: true },
      });
      if (!pr) throw new NotFoundException("Purchase request not found");
      if (pr.status !== "DRAFT") throw new ConflictException("Only a DRAFT purchase request can be submitted");
      if (pr.items.length === 0) throw new ConflictException("At least one item is required to submit a purchase request");

      const submittedAt = new Date();
      // Atomic conditional DRAFT -> UNDER_APPROVAL transition (§7) — the ONLY
      // guard against two concurrent submits both creating an
      // ApprovalInstance/ApprovalStepInstance/audit row: exactly one caller's
      // `WHERE status = 'DRAFT'` matches (Postgres row lock), the other
      // matches zero rows and 409s here, before ever touching approval
      // tables. ApprovalInstance.purchaseRequestId is ALSO DB-unique (schema,
      // pre-existing) — a pure backstop, not the primary guard: this
      // updateMany is what actually prevents the race, the unique index
      // would only ever fire if this guard had a bug.
      const result = await tx.purchaseRequest.updateMany({
        where: { id: pr.id, organizationId, status: "DRAFT" },
        data: { status: "UNDER_APPROVAL", submittedAt },
      });
      if (result.count !== 1) throw new ConflictException("Purchase request is no longer a DRAFT");

      const instance = await tx.approvalInstance.create({
        data: { entityType: "PURCHASE_REQUEST", purchaseRequestId: pr.id, status: "PENDING" },
      });
      // assignedUserId always null here — M3.1 has no approver-assignment
      // mechanism (§9: APPROVER remains structurally dormant until a future
      // slice adds one). approverRole PROCUREMENT_MANAGER is the only
      // M3.1-decided role (§10) — ADMIN's approve access is a role-level
      // override checked in requireDecidableTx's visibility, not encoded here.
      await tx.approvalStepInstance.create({
        data: { approvalInstanceId: instance.id, stepOrder: 1, approverRole: "PROCUREMENT_MANAGER", assignedUserId: null, status: "PENDING" },
      });

      await this.audit.log(
        {
          organizationId,
          userId: actorUserId,
          action: "PURCHASE_REQUEST_SUBMITTED",
          entityType: "PurchaseRequest",
          entityId: pr.id,
          oldValue: { status: "DRAFT" },
          newValue: { status: "UNDER_APPROVAL", submittedAt: submittedAt.toISOString() },
        },
        tx
      );

      return this.loadSummaryTx(tx, organizationId, pr.id);
    });

    // Strictly after commit (Phase F §6/§8) — a lost concurrency race throws
    // inside the transaction above and never reaches this line at all.
    this.events.publishPurchaseRequestSubmitted({
      organizationId,
      entityId: summary.id,
      actorUserId,
      payload: { status: "UNDER_APPROVAL" },
    });
    return summary;
  }

  async approve(organizationId: string, actorUserId: string, actorRole: UserRole, id: string): Promise<PurchaseRequestSummary> {
    const summary = await this.db.$transaction(async (tx) => {
      const { pr, step } = await this.requireDecidableTx(tx, organizationId, actorUserId, actorRole, id);
      const decidedAt = new Date();

      // Three independently-guarded atomic transitions, in this exact order
      // (§14): step first (the row two racing approve/reject calls actually
      // contend on — whichever's UPDATE commits first wins, the other's
      // WHERE status='PENDING' re-evaluates against the now-decided row and
      // matches zero), then PR, then instance. Any guard failing throws,
      // which rolls back the WHOLE transaction automatically (interactive
      // $transaction semantics) — never a partial commit of one but not the
      // others (§16/§17).
      const stepResult = await tx.approvalStepInstance.updateMany({
        where: { id: step.id, status: "PENDING" },
        data: { status: "APPROVED", decidedById: actorUserId, decidedAt },
      });
      if (stepResult.count !== 1) throw new ConflictException("Approval step is no longer pending");

      const prResult = await tx.purchaseRequest.updateMany({
        where: { id: pr.id, organizationId, status: "UNDER_APPROVAL" },
        data: { status: "APPROVED" },
      });
      if (prResult.count !== 1) throw new ConflictException("Purchase request is no longer under approval");

      const instanceResult = await tx.approvalInstance.updateMany({
        where: { id: pr.approvalInstance.id, status: "PENDING" },
        data: { status: "APPROVED", completedAt: decidedAt },
      });
      if (instanceResult.count !== 1) throw new ConflictException("Approval instance is no longer pending");

      await this.audit.log(
        {
          organizationId,
          userId: actorUserId,
          action: "PURCHASE_REQUEST_APPROVED",
          entityType: "PurchaseRequest",
          entityId: pr.id,
          oldValue: { status: "UNDER_APPROVAL" },
          newValue: { status: "APPROVED" },
        },
        tx
      );

      return this.loadSummaryTx(tx, organizationId, pr.id);
    });

    this.events.publishPurchaseRequestApproved({
      organizationId,
      entityId: summary.id,
      actorUserId,
      payload: { status: "APPROVED" },
    });
    return summary;
  }

  async reject(
    organizationId: string,
    actorUserId: string,
    actorRole: UserRole,
    id: string,
    input: RejectPurchaseRequestInput
  ): Promise<PurchaseRequestSummary> {
    const summary = await this.db.$transaction(async (tx) => {
      const { pr, step } = await this.requireDecidableTx(tx, organizationId, actorUserId, actorRole, id);
      const decidedAt = new Date();

      const stepResult = await tx.approvalStepInstance.updateMany({
        where: { id: step.id, status: "PENDING" },
        data: { status: "REJECTED", decidedById: actorUserId, decidedAt, comment: input.reason },
      });
      if (stepResult.count !== 1) throw new ConflictException("Approval step is no longer pending");

      const prResult = await tx.purchaseRequest.updateMany({
        where: { id: pr.id, organizationId, status: "UNDER_APPROVAL" },
        data: { status: "REJECTED" },
      });
      if (prResult.count !== 1) throw new ConflictException("Purchase request is no longer under approval");

      const instanceResult = await tx.approvalInstance.updateMany({
        where: { id: pr.approvalInstance.id, status: "PENDING" },
        data: { status: "REJECTED", completedAt: decidedAt },
      });
      if (instanceResult.count !== 1) throw new ConflictException("Approval instance is no longer pending");

      await this.audit.log(
        {
          organizationId,
          userId: actorUserId,
          action: "PURCHASE_REQUEST_REJECTED",
          entityType: "PurchaseRequest",
          entityId: pr.id,
          oldValue: { status: "UNDER_APPROVAL" },
          newValue: { status: "REJECTED", reason: input.reason },
        },
        tx
      );

      return this.loadSummaryTx(tx, organizationId, pr.id);
    });

    // Payload deliberately omits `reason` (Phase F §10) — REST detail owns it.
    this.events.publishPurchaseRequestRejected({
      organizationId,
      entityId: summary.id,
      actorUserId,
      payload: { status: "REJECTED" },
    });
    return summary;
  }

  /**
   * Shared by approve()/reject() (§10/§11 have identical preconditions —
   * only the resulting step status/fields differ). Reuses `visibilityWhere`
   * unmodified: its APPROVER branch already restricts to PRs with a step
   * `assignedUserId == actorUserId`, which is exactly "APPROVER only if
   * assigned" (§10) — no separate check needed. Since M3.1's submit() never
   * sets assignedUserId, an APPROVER's lookup here always matches zero rows
   * and 404s, same documented "APPROVER sees nothing yet" mechanism as
   * Phase D's read-side visibility (§9 dormancy) — not a special case.
   */
  private async requireDecidableTx(
    tx: TenantTransactionClient,
    organizationId: string,
    actorUserId: string,
    actorRole: UserRole,
    id: string
  ): Promise<{ pr: PurchaseRequestRow & { approvalInstance: ApprovalInstanceWithSteps }; step: ApprovalStepInstanceRow }> {
    const pr = await tx.purchaseRequest.findFirst({
      where: { id, ...visibilityWhere(organizationId, actorUserId, actorRole) },
      include: { approvalInstance: { include: { steps: true } } },
    });
    if (!pr) throw new NotFoundException("Purchase request not found");
    if (pr.status !== "UNDER_APPROVAL") throw new ConflictException("Purchase request is not awaiting approval");
    if (!pr.approvalInstance || pr.approvalInstance.status !== "PENDING") {
      throw new ConflictException("Approval instance is not pending");
    }
    const step = pr.approvalInstance.steps.find((s) => s.stepOrder === 1);
    if (!step || step.status !== "PENDING") throw new ConflictException("Approval step is not pending");
    return { pr: pr as PurchaseRequestRow & { approvalInstance: ApprovalInstanceWithSteps }, step };
  }

  /**
   * DRAFT -> CANCELLED (any actor this method's caller allows) or
   * APPROVED -> CANCELLED (ADMIN/PROCUREMENT_MANAGER only — §20). Approval
   * history (ApprovalInstance/ApprovalStepInstance/its audit row) is never
   * touched here — cancellation is an additional historical fact layered on
   * top, not a correction of what already happened (§24).
   */
  async cancel(organizationId: string, actorUserId: string, actorRole: UserRole, id: string): Promise<PurchaseRequestSummary> {
    const summary = await this.db.$transaction(async (tx) => {
      const pr = await tx.purchaseRequest.findFirst({ where: { id, ...visibilityWhere(organizationId, actorUserId, actorRole) } });
      if (!pr) throw new NotFoundException("Purchase request not found");

      if (pr.status === "APPROVED") {
        // EMPLOYEE may legitimately own this PR (visibilityWhere already let
        // them load it) but may never cancel an APPROVED one — only its own
        // DRAFT (§19/§20). This is a role restriction, not a state
        // conflict, hence 403 rather than 409.
        if (actorRole === "EMPLOYEE") throw new ForbiddenException("Only ADMIN/PROCUREMENT_MANAGER may cancel an approved purchase request");
      } else if (pr.status !== "DRAFT") {
        // UNDER_APPROVAL is explicitly NOT cancellable in M3.1 (§21/§23), nor
        // are REJECTED/CANCELLED/RFQ_IN_PROGRESS/PO_CREATED/CLOSED.
        throw new ConflictException("Purchase request cannot be cancelled from its current status");
      }

      const cancelledAt = new Date();
      // Guards on the EXACT status already validated above (DRAFT or
      // APPROVED) — same atomic-conditional-transition discipline as every
      // other action in this phase (§22): a concurrent transition away from
      // that status loses the race safely, 409, never a silent overwrite.
      const result = await tx.purchaseRequest.updateMany({
        where: { id: pr.id, organizationId, status: pr.status },
        data: { status: "CANCELLED", cancelledAt, cancelledByUserId: actorUserId },
      });
      if (result.count !== 1) throw new ConflictException("Purchase request status changed concurrently");

      await this.audit.log(
        {
          organizationId,
          userId: actorUserId,
          action: "PURCHASE_REQUEST_CANCELLED",
          entityType: "PurchaseRequest",
          entityId: pr.id,
          oldValue: { status: pr.status },
          newValue: { status: "CANCELLED", cancelledAt: cancelledAt.toISOString(), cancelledByUserId: actorUserId },
        },
        tx
      );

      return this.loadSummaryTx(tx, organizationId, pr.id);
    });

    this.events.publishPurchaseRequestCancelled({
      organizationId,
      entityId: summary.id,
      actorUserId,
      payload: { status: "CANCELLED" },
    });
    return summary;
  }

  /**
   * Reassignable while SUBMITTED/UNDER_APPROVAL/APPROVED (§27). Same-buyer
   * reassignment is a documented no-op — no write, no audit (§28/§30).
   * Concurrent reassignment to DIFFERENT buyers is explicitly last-write-wins
   * with no version column (§29) — only the underlying updateMany's status
   * guard is atomic, and that guards the STATE-MACHINE legality (so a
   * concurrent cancel/reject cannot be raced into an assignment landing on a
   * since-terminal PR), not "who wins the buyer value."
   */
  async assign(
    organizationId: string,
    actorUserId: string,
    actorRole: UserRole,
    id: string,
    input: AssignPurchaseRequestInput
  ): Promise<PurchaseRequestSummary> {
    // Set only on the real-change path below — stays null through the
    // no-op-reassignment return, which is exactly how publish is skipped for
    // it (Phase F §12 mirrors Phase E's own no-op-writes-no-audit rule).
    let assignedBuyerUserId: string | null = null;

    const summary = await this.db.$transaction(async (tx) => {
      const pr = await tx.purchaseRequest.findFirst({ where: { id, ...visibilityWhere(organizationId, actorUserId, actorRole) } });
      if (!pr) throw new NotFoundException("Purchase request not found");
      if (!ASSIGNABLE_STATUSES.includes(pr.status)) {
        throw new ConflictException("Purchase request is not in an assignable state");
      }

      // Not-found and foreign-tenant both 404 identically (§93 "rejected
      // safely") — the organizationId scope means a foreign-org user simply
      // never matches, same non-distinguishing mechanism used everywhere
      // else in this codebase for cross-tenant lookups.
      const target = await tx.user.findFirst({ where: { id: input.assignedBuyerUserId, organizationId } });
      if (!target) throw new NotFoundException("Target user not found");
      if (!target.active) throw new BadRequestException("Target user is not active");
      if (!ELIGIBLE_BUYER_ROLES.includes(target.role)) {
        throw new BadRequestException("Target user is not an eligible buyer role");
      }

      if (pr.assignedBuyerUserId === target.id) {
        return this.loadSummaryTx(tx, organizationId, pr.id);
      }

      const result = await tx.purchaseRequest.updateMany({
        where: { id: pr.id, organizationId, status: { in: ASSIGNABLE_STATUSES } },
        data: { assignedBuyerUserId: target.id },
      });
      if (result.count !== 1) throw new ConflictException("Purchase request is no longer assignable");

      await this.audit.log(
        {
          organizationId,
          userId: actorUserId,
          action: "PURCHASE_REQUEST_ASSIGNED",
          entityType: "PurchaseRequest",
          entityId: pr.id,
          oldValue: { assignedBuyerUserId: pr.assignedBuyerUserId },
          newValue: { assignedBuyerUserId: target.id },
        },
        tx
      );

      assignedBuyerUserId = target.id;
      return this.loadSummaryTx(tx, organizationId, pr.id);
    });

    if (assignedBuyerUserId) {
      this.events.publishPurchaseRequestAssigned({
        organizationId,
        entityId: summary.id,
        actorUserId,
        payload: { assignedBuyerUserId },
      });
    }
    return summary;
  }

  // ────────────────────────────────────────────────────────────
  // Shared tx-aware helpers
  // ────────────────────────────────────────────────────────────

  private async requireDepartmentTx(tx: TenantTransactionClient, organizationId: string, id: string): Promise<void> {
    const department = await tx.department.findFirst({ where: { id, organizationId } });
    if (!department) throw new NotFoundException("Department not found");
  }

  private async requireCategoryTx(tx: TenantTransactionClient, organizationId: string, id: string): Promise<void> {
    const category = await tx.category.findFirst({ where: { id, organizationId } });
    if (!category) throw new NotFoundException("Category not found");
  }

  /**
   * Never fetch/update an item by itemId alone (§27) — always scoped to the
   * already tenant-and-ownership-checked parent's id, never the client's
   * own claim about which PR it belongs to.
   */
  private async requireEditableDraftTx(
    tx: TenantTransactionClient,
    organizationId: string,
    actorUserId: string,
    actorRole: UserRole,
    id: string
  ): Promise<PurchaseRequestRow> {
    const pr = await tx.purchaseRequest.findFirst({ where: { id, ...visibilityWhere(organizationId, actorUserId, actorRole) } });
    if (!pr) throw new NotFoundException("Purchase request not found");
    if (pr.status !== "DRAFT") throw new ConflictException("Only a DRAFT purchase request can be edited");
    return pr;
  }

  private async requireItemTx(tx: TenantTransactionClient, purchaseRequestId: string, itemId: string): Promise<PurchaseRequestItemRow> {
    const item = await tx.purchaseRequestItem.findFirst({ where: { id: itemId, purchaseRequestId } });
    if (!item) throw new NotFoundException("Purchase request item not found");
    return item;
  }

  /**
   * Product-backed (productId given): itemName/skuSnapshot are ALWAYS
   * server-derived from the current Product row here — never trust a client
   * snapshot (none is even accepted by the DTO layer, but this is the
   * authoritative source regardless). No active-only restriction: Product
   * has no notion of "cannot be referenced while archived" anywhere else in
   * the existing architecture (`active` only gates default list visibility
   * — see ProductsService — never reference validity), so requesting
   * against an archived Product is accepted, consistent with that.
   * Free-text (productId absent): itemName/skuSnapshot come from the
   * client/absent, validated already by the DTO layer.
   */
  private async resolveItemData(
    tx: TenantTransactionClient,
    organizationId: string,
    item: PurchaseRequestItemInput
  ): Promise<Omit<Prisma.PurchaseRequestItemUncheckedCreateInput, "purchaseRequestId">> {
    let itemName: string;
    let skuSnapshot: string | null = null;
    let productId: string | null = null;

    if (item.productId) {
      const product = await tx.product.findFirst({ where: { id: item.productId, organizationId } });
      if (!product) throw new NotFoundException("Product not found");
      itemName = product.name;
      skuSnapshot = product.sku;
      productId = product.id;
    } else {
      itemName = item.itemName!; // required by the DTO layer's superRefine when productId is absent
    }

    return {
      productId,
      itemName,
      skuSnapshot,
      description: item.description ?? null,
      quantity: item.quantity,
      uomCode: item.uomCode,
      technicalSpec: (item.technicalSpec ?? undefined) as Prisma.InputJsonValue | undefined,
      requiredDate: item.requiredDate ? new Date(item.requiredDate) : null,
      notes: item.notes ?? null,
    };
  }
}

/** Hashes the create payload minus idempotencyKey itself (Phase D §9) — the key is metadata about the request, not part of its business intent. */
function computeCreateHash(input: CreatePurchaseRequestInput): string {
  const { idempotencyKey: _idempotencyKey, ...hashable } = input;
  return computePayloadHash(hashable);
}

function toItemSummary(item: PurchaseRequestItemRow): PurchaseRequestItemSummary {
  return {
    id: item.id,
    productId: item.productId,
    itemName: item.itemName,
    skuSnapshot: item.skuSnapshot,
    description: item.description,
    quantity: item.quantity.toString(),
    uomCode: item.uomCode as PurchaseRequestItemSummary["uomCode"],
    technicalSpec: (item.technicalSpec as Record<string, unknown> | null) ?? null,
    requiredDate: item.requiredDate?.toISOString() ?? null,
    notes: item.notes,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function toSummary(pr: PurchaseRequestWithApproval): PurchaseRequestSummary {
  return {
    id: pr.id,
    requestNumber: pr.requestNumber,
    requesterId: pr.requesterId,
    departmentId: pr.departmentId,
    categoryId: pr.categoryId,
    status: pr.status as PurchaseRequestSummary["status"],
    priority: pr.priority as PurchaseRequestSummary["priority"],
    requiredDate: pr.requiredDate?.toISOString() ?? null,
    reason: pr.reason,
    estimatedBudget: pr.estimatedBudget?.toString() ?? null,
    currency: pr.currency,
    assignedBuyerUserId: pr.assignedBuyerUserId,
    submittedAt: pr.submittedAt?.toISOString() ?? null,
    cancelledAt: pr.cancelledAt?.toISOString() ?? null,
    cancelledByUserId: pr.cancelledByUserId,
    createdAt: pr.createdAt.toISOString(),
    updatedAt: pr.updatedAt.toISOString(),
    items: pr.items.map(toItemSummary),
    approval: toApprovalView(pr.approvalInstance),
  };
}

function toApprovalView(instance: ApprovalInstanceWithSteps | null): PurchaseRequestApprovalView | null {
  if (!instance) return null;
  // M3.1 has exactly one step (stepOrder=1) — a future multi-step approval
  // slice would need to widen this to expose more than index 0 (out of
  // Phase E's scope, see §31 "bounded detail approval view").
  const step = instance.steps[0] ?? null;
  return {
    status: instance.status as PurchaseRequestApprovalView["status"],
    completedAt: instance.completedAt?.toISOString() ?? null,
    step: step
      ? {
          status: step.status as PurchaseRequestApprovalStepView["status"],
          stepOrder: step.stepOrder,
          approverRole: step.approverRole as PurchaseRequestApprovalStepView["approverRole"],
          assignedUserId: step.assignedUserId,
          decidedById: step.decidedById,
          decidedAt: step.decidedAt?.toISOString() ?? null,
          comment: step.comment,
        }
      : null,
  };
}

function toListItem(pr: PurchaseRequestListRow): PurchaseRequestListItem {
  return {
    id: pr.id,
    requestNumber: pr.requestNumber,
    status: pr.status as PurchaseRequestListItem["status"],
    priority: pr.priority as PurchaseRequestListItem["priority"],
    requesterId: pr.requesterId,
    departmentId: pr.departmentId,
    assignedBuyerUserId: pr.assignedBuyerUserId,
    requiredDate: pr.requiredDate?.toISOString() ?? null,
    itemCount: pr._count.items,
    createdAt: pr.createdAt.toISOString(),
  };
}
