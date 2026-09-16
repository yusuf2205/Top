import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@top/database";
import type { createTenantSafePrismaClient, UserRole } from "@top/database";
import type { TenantTransactionClient } from "../database/database.module";
import type { CreateStockMovementInput, ListStockMovementsQuery } from "@top/validation";
import type {
  StockMovementLineSummary,
  StockMovementListItem,
  StockMovementListResult,
  StockMovementSummary,
  StockMovementType,
} from "@top/types";
import { TENANT_PRISMA } from "../database/database.module";
import { AuditService } from "../common/audit/audit.service";
import { computePayloadHash } from "../common/canonical-hash.util";
import { DomainEventsService } from "../realtime/domain-events.service";
import { WarehousesService } from "../warehouses/warehouses.service";
import { UomConversionsService } from "../products/uom-conversions.service";
import { StockLotsService } from "./stock-lots.service";
import { StockBalancesService } from "./stock-balances.service";
import { StockLotPlacementsService } from "./stock-lot-placements.service";
import { StockPiecesService } from "./stock-pieces.service";
import { isRetryableTransactionError } from "./transaction-conflict.util";

type TenantDb = ReturnType<typeof createTenantSafePrismaClient>;
type MovementWithLines = Awaited<ReturnType<TenantDb["stockMovement"]["findFirstOrThrow"]>> & {
  lines: Awaited<ReturnType<TenantDb["stockMovementLine"]["findMany"]>>;
};
/** LIST row shape (Phase G) — header fields plus a `_count.lines`, never the lines themselves. */
type MovementListRow = Awaited<ReturnType<TenantDb["stockMovement"]["findFirstOrThrow"]>> & {
  _count: { lines: number };
};

type ReceiptInput = Extract<CreateStockMovementInput, { type: "RECEIPT" }>;
type IssueInput = Extract<CreateStockMovementInput, { type: "ISSUE" }>;
type TransferInput = Extract<CreateStockMovementInput, { type: "TRANSFER" }>;
type AdjustmentInput = Extract<CreateStockMovementInput, { type: "ADJUSTMENT" }>;
type ScrapInput = Extract<CreateStockMovementInput, { type: "SCRAP" }>;
type SplitInput = Extract<CreateStockMovementInput, { type: "SPLIT" }>;

/**
 * Internal marker only — never extends HttpException, never allowed to
 * escape this file uncaught. Signals specifically "the header insert hit
 * the idempotency partial unique index," distinguished at the point of
 * failure (inside the transaction callback, immediately after the header
 * insert — nothing else has run yet) rather than by inspecting Prisma error
 * metadata afterward. This is deliberately NOT "catching and continuing on
 * the same failed transaction" (forbidden, and the exact bug found in
 * Phase E) — it is caught, translated to this marker, and immediately
 * rethrown, so Prisma's own rollback-on-throw still fires normally; the
 * actual recovery (reload by key, compare hash) happens in `attempt()`,
 * strictly outside the failed transaction.
 */
class IdempotencyConflictMarker extends Error {}

const MOVEMENT_TYPE_ROLES: Record<StockMovementType, UserRole[]> = {
  RECEIPT: ["ADMIN", "PROCUREMENT_MANAGER"],
  ISSUE: ["ADMIN", "PROCUREMENT_MANAGER"],
  TRANSFER: ["ADMIN", "PROCUREMENT_MANAGER"],
  SCRAP: ["ADMIN", "PROCUREMENT_MANAGER"],
  SPLIT: ["ADMIN", "PROCUREMENT_MANAGER"],
  ADJUSTMENT: ["ADMIN"],
};

/** Bounded retry of the WHOLE transaction boundary only — never a partial step (Architecture Gate §20/Phase E). */
const MAX_TRANSACTION_RETRIES = 1;

/**
 * M2.5 (Architecture Gate Revision 2, Phase F). The single canonical
 * business-command path for all stock mutation — StockMovement + its
 * StockMovementLine(s) are the immutable ledger; StockBalance/
 * StockLotPlacement/StockPiece are mutated only from here, only inside the
 * same transaction as the movement they belong to. See schema.prisma's own
 * StockMovement/StockMovementLine doc comments for the full accounting
 * model (`effect` is the sole accounting discriminator; lineage fields
 * never imply accounting effect).
 */
@Injectable()
export class StockMovementsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly events: DomainEventsService,
    private readonly warehouses: WarehousesService,
    private readonly uomConversions: UomConversionsService,
    private readonly lots: StockLotsService,
    private readonly balances: StockBalancesService,
    private readonly placements: StockLotPlacementsService,
    private readonly pieces: StockPiecesService
  ) {}

  async create(
    organizationId: string,
    actorUserId: string,
    actorRole: UserRole,
    input: CreateStockMovementInput
  ): Promise<StockMovementSummary> {
    // Locked rule (Phase 0 correction): authorization is checked BEFORE the
    // idempotency lookup, unconditionally, on both the fresh and the replay
    // path — a replay must never let a caller observe or receive a result
    // for a movement type they are not themselves authorized to execute.
    this.assertAuthorized(actorRole, input.type);

    const payloadHash = input.idempotencyKey ? computePayloadHash(input) : undefined;

    if (input.idempotencyKey) {
      const existing = await this.db.stockMovement.findFirst({ where: { organizationId, idempotencyKey: input.idempotencyKey } });
      if (existing) {
        return this.resolveIdempotentReplay(organizationId, existing, payloadHash!);
      }
    }

    const { id: movementId, isNew } = await this.attempt(organizationId, actorUserId, input, payloadHash, MAX_TRANSACTION_RETRIES);
    const summary = await this.loadSummary(organizationId, movementId);

    // Realtime Foundation: publish strictly AFTER the transaction that
    // created `movementId` has already committed (attempt()/executeMovement
    // never call this — see DomainEventsService's own doc comment on why
    // that would be unsafe), and ONLY for a genuinely new movement. `isNew`
    // is false for both replay paths (the pre-check above, and the
    // IdempotencyConflictMarker-resolved replay inside attempt()'s catch) —
    // a repeated idempotent POST must never produce a second
    // STOCK_MOVEMENT_CREATED event.
    if (isNew) {
      this.events.publishStockMovementCreated({
        organizationId,
        entityId: summary.id,
        actorUserId,
        payload: { type: summary.type },
      });
    }

    return summary;
  }

  // ────────────────────────────────────────────────────────────
  // READ SIDE (M2.5 Phase G). Deliberately plain `this.db` reads — no
  // `$transaction`, no retry, no idempotency, no authorization narrower than
  // "any authenticated org member" (RBAC matrix unchanged). Never mutates
  // anything, never calls `audit.log(...)`. StockMovement/StockMovementLine
  // are immutable history — these two methods read exactly the values
  // stored at movement time; they never recompute from current StockBalance/
  // Product/UOM state (see schema.prisma's own doc comments).
  // ────────────────────────────────────────────────────────────

  async list(organizationId: string, query: ListStockMovementsQuery): Promise<StockMovementListResult> {
    const where: Prisma.StockMovementWhereInput = {
      organizationId,
      ...(query.type ? { type: query.type } : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.referenceType ? { referenceType: query.referenceType } : {}),
      ...(query.referenceId ? { referenceId: query.referenceId } : {}),
      ...(query.createdAtFrom || query.createdAtTo
        ? {
            createdAt: {
              ...(query.createdAtFrom ? { gte: new Date(query.createdAtFrom) } : {}),
              ...(query.createdAtTo ? { lte: new Date(query.createdAtTo) } : {}),
            },
          }
        : {}),
      // organizationId repeated explicitly inside each nested `lines.some`
      // filter (not just relying on the header-level one above) so Postgres
      // can use StockMovementLine's own (organizationId, productId/
      // sourcePieceId/sourceLotId) composite indexes for the correlated
      // subquery Prisma generates — not just the header's.
      ...(query.productId ? { lines: { some: { organizationId, productId: query.productId } } } : {}),
      ...(query.sourcePieceId ? { lines: { some: { organizationId, sourcePieceId: query.sourcePieceId } } } : {}),
      ...(query.sourceLotId ? { lines: { some: { organizationId, sourceLotId: query.sourceLotId } } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.db.stockMovement.findMany({
        where,
        // createdAt DESC with `id` as a stable tiebreaker — two movements can
        // share a createdAt timestamp (same millisecond), and without a
        // secondary key, offset pagination could show a row twice or skip
        // one across pages.
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { _count: { select: { lines: true } } },
      }),
      this.db.stockMovement.count({ where }),
    ]);

    return { items: rows.map(toListItem), total, page: query.page, pageSize: query.pageSize };
  }

  async get(organizationId: string, id: string): Promise<StockMovementSummary> {
    return this.loadSummary(organizationId, id);
  }

  private assertAuthorized(role: UserRole, type: StockMovementType): void {
    if (!MOVEMENT_TYPE_ROLES[type].includes(role)) {
      throw new ForbiddenException(`Role ${role} is not authorized to create a ${type} movement`);
    }
  }

  private async resolveIdempotentReplay(
    organizationId: string,
    existing: { id: string; payloadHash: string | null },
    payloadHash: string
  ): Promise<StockMovementSummary> {
    if (existing.payloadHash !== payloadHash) {
      throw new ConflictException("idempotencyKey was already used with a different request payload");
    }
    return this.loadSummary(organizationId, existing.id);
  }

  /**
   * `isNew` (Realtime Foundation) distinguishes "this call's own transaction
   * genuinely committed a brand-new header" (true — the direct `try` return)
   * from "resolved to an already-existing movement via idempotency replay"
   * (false — both replay branches below). The bounded-retry recursive call
   * simply forwards whatever the inner attempt determines; a retry is still
   * the SAME logical new attempt, not a replay, so it keeps `isNew: true`
   * when it eventually succeeds.
   */
  private async attempt(
    organizationId: string,
    actorUserId: string,
    input: CreateStockMovementInput,
    payloadHash: string | undefined,
    retriesLeft: number
  ): Promise<{ id: string; isNew: boolean }> {
    try {
      const id = await this.db.$transaction((tx) => this.executeMovement(tx, organizationId, actorUserId, input, payloadHash));
      return { id, isNew: true };
    } catch (err) {
      if (err instanceof IdempotencyConflictMarker) {
        if (!input.idempotencyKey) throw err; // should be unreachable — marker only thrown when a key was supplied
        const existing = await this.db.stockMovement.findFirst({ where: { organizationId, idempotencyKey: input.idempotencyKey } });
        if (existing) {
          const summary = await this.resolveIdempotentReplay(organizationId, existing, payloadHash!);
          return { id: summary.id, isNew: false };
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

  private async executeMovement(
    tx: TenantTransactionClient,
    organizationId: string,
    actorUserId: string,
    input: CreateStockMovementInput,
    payloadHash: string | undefined
  ): Promise<string> {
    // Header inserted FIRST, before any validation/mutation work — a
    // duplicate idempotencyKey fails fast here, before anything else runs.
    let movement: { id: string };
    try {
      movement = await tx.stockMovement.create({
        data: {
          organizationId,
          type: input.type,
          referenceType: input.referenceType ?? null,
          referenceId: input.referenceId ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
          payloadHash: payloadHash ?? null,
          actorUserId,
          reason: input.reason ?? null,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new IdempotencyConflictMarker();
      }
      throw err;
    }

    if (input.referenceType === "PURCHASE_ORDER") {
      const po = await tx.purchaseOrder.findFirst({ where: { id: input.referenceId, organizationId } });
      if (!po) throw new NotFoundException("Referenced purchase order not found");
    } else if (input.referenceType === "STOCK_MOVEMENT") {
      const original = await tx.stockMovement.findFirst({ where: { id: input.referenceId, organizationId } });
      if (!original) throw new NotFoundException("Referenced movement not found");
    }

    switch (input.type) {
      case "RECEIPT":
        await this.executeReceipt(tx, organizationId, movement.id, input);
        break;
      case "ISSUE":
        await this.executeOutbound(tx, organizationId, movement.id, input, "CONSUMED");
        break;
      case "SCRAP":
        await this.executeOutbound(tx, organizationId, movement.id, input, "SCRAPPED");
        break;
      case "TRANSFER":
        await this.executeTransfer(tx, organizationId, movement.id, input);
        break;
      case "ADJUSTMENT":
        await this.executeAdjustment(tx, organizationId, movement.id, input);
        break;
      case "SPLIT":
        await this.executeSplit(tx, organizationId, movement.id, input);
        break;
    }

    await this.audit.log(
      {
        organizationId,
        userId: actorUserId,
        action: "STOCK_MOVEMENT_CREATED",
        entityType: "StockMovement",
        entityId: movement.id,
        newValue: {
          type: input.type,
          lineCount: input.lines.length,
          referenceType: input.referenceType ?? null,
          referenceId: input.referenceId ?? null,
          reason: input.reason ?? null,
        },
      },
      tx
    );

    return movement.id;
  }

  // ──────────────────────────────────────────────────────────
  // RECEIPT — effect: INBOUND
  // ──────────────────────────────────────────────────────────
  private async executeReceipt(tx: TenantTransactionClient, organizationId: string, movementId: string, input: ReceiptInput) {
    for (const line of input.lines) {
      const product = await this.requireProductTx(tx, organizationId, line.productId);
      const warehouse = await this.warehouses.requireWarehouseTx(tx, organizationId, line.warehouseId);
      const location = await this.requireOptionalLocationTx(tx, organizationId, line.locationId, line.warehouseId);
      this.assertDestinationActive(warehouse, location);
      if (line.supplierId) {
        await this.requireSupplierTx(tx, organizationId, line.supplierId);
      }

      if (product.trackingMode === "PIECE") {
        if (!line.pieces) {
          throw new BadRequestException(`Product ${product.sku} is PIECE-tracked and requires pieces[]`);
        }
        const lot = await tx.stockLot.create({
          data: { organizationId, productId: product.id, supplierId: line.supplierId ?? null, lotNumber: line.lotNumber ?? null },
        });
        for (const p of line.pieces) {
          const baseQuantity = await this.convertTx(tx, organizationId, product.id, p.quantity, p.uomCode, product.baseUomCode);
          const piece = await tx.stockPiece.create({
            data: {
              organizationId,
              productId: product.id,
              lotId: lot.id,
              warehouseId: line.warehouseId,
              locationId: line.locationId ?? null,
              quantity: p.quantity,
              uomCode: p.uomCode,
            },
          });
          await tx.stockMovementLine.create({
            data: {
              organizationId,
              movementId,
              productId: product.id,
              effect: "INBOUND",
              destPieceId: piece.id,
              destLotId: lot.id,
              destWarehouseId: line.warehouseId,
              destLocationId: line.locationId ?? null,
              uomCode: p.uomCode,
              quantity: p.quantity,
              baseQuantity,
            },
          });
          await this.balances.incrementOnHand(tx, organizationId, {
            productId: product.id,
            warehouseId: line.warehouseId,
            locationId: line.locationId ?? null,
            uomCode: product.baseUomCode,
            amount: baseQuantity,
          });
        }
      } else {
        if (!line.quantity || !line.uomCode) {
          throw new BadRequestException(`Product ${product.sku} requires quantity and uomCode`);
        }
        const baseQuantity = await this.convertTx(tx, organizationId, product.id, line.quantity, line.uomCode, product.baseUomCode);
        let destLotId: string | null = null;

        if (product.trackingMode === "LOT") {
          const lot = await tx.stockLot.create({
            data: { organizationId, productId: product.id, supplierId: line.supplierId ?? null, lotNumber: line.lotNumber ?? null },
          });
          destLotId = lot.id;
          await this.placements.incrementOrCreatePlacement(tx, organizationId, {
            stockLotId: lot.id,
            productId: product.id,
            warehouseId: line.warehouseId,
            locationId: line.locationId ?? null,
            uomCode: product.baseUomCode,
            amount: baseQuantity,
          });
        }

        await tx.stockMovementLine.create({
          data: {
            organizationId,
            movementId,
            productId: product.id,
            effect: "INBOUND",
            destLotId,
            destWarehouseId: line.warehouseId,
            destLocationId: line.locationId ?? null,
            uomCode: line.uomCode,
            quantity: line.quantity,
            baseQuantity,
          },
        });

        await this.balances.incrementOnHand(tx, organizationId, {
          productId: product.id,
          warehouseId: line.warehouseId,
          locationId: line.locationId ?? null,
          uomCode: product.baseUomCode,
          amount: baseQuantity,
        });
      }
    }
  }

  // ──────────────────────────────────────────────────────────
  // ISSUE / SCRAP — effect: OUTBOUND
  // ──────────────────────────────────────────────────────────
  private async executeOutbound(
    tx: TenantTransactionClient,
    organizationId: string,
    movementId: string,
    input: IssueInput | ScrapInput,
    targetStatus: "CONSUMED" | "SCRAPPED"
  ) {
    for (const line of input.lines) {
      if (line.sourcePieceId) {
        const parent = await this.pieces.requireAvailablePieceTx(tx, organizationId, line.sourcePieceId);
        const product = await this.requireProductTx(tx, organizationId, parent.productId);
        const requested = new Prisma.Decimal(line.quantity);
        if (requested.greaterThan(parent.quantity)) {
          throw new BadRequestException("Requested quantity exceeds the piece's own quantity");
        }
        const isFull = requested.equals(parent.quantity);
        const baseQuantity = await this.convertTx(tx, organizationId, product.id, line.quantity, parent.uomCode, product.baseUomCode);

        await this.pieces.transitionStatusTx(tx, organizationId, parent.id, targetStatus);

        let destPieceId: string | null = null;
        if (!isFull) {
          const remnant = new Prisma.Decimal(parent.quantity).sub(requested).toFixed(3);
          const child = await this.pieces.createChildTx(tx, organizationId, parent, remnant);
          destPieceId = child.id;
        }

        await tx.stockMovementLine.create({
          data: {
            organizationId,
            movementId,
            productId: product.id,
            effect: "OUTBOUND",
            sourcePieceId: parent.id,
            destPieceId,
            sourceWarehouseId: parent.warehouseId,
            sourceLocationId: parent.locationId,
            uomCode: parent.uomCode,
            quantity: line.quantity,
            baseQuantity,
          },
        });

        await this.balances.decrementOnHand(tx, organizationId, {
          productId: product.id,
          warehouseId: parent.warehouseId,
          locationId: parent.locationId,
          amount: baseQuantity,
        });
      } else {
        const product = await this.requireProductTx(tx, organizationId, line.productId!);
        await this.warehouses.requireWarehouseTx(tx, organizationId, line.warehouseId!);
        await this.requireOptionalLocationTx(tx, organizationId, line.locationId, line.warehouseId!);
        // Outbound source — inactive warehouse/location is explicitly allowed (existing stock may always leave).

        const baseQuantity = await this.convertTx(tx, organizationId, product.id, line.quantity, line.uomCode!, product.baseUomCode);

        if (line.sourceLotId) {
          await this.lots.requireLotTx(tx, organizationId, line.sourceLotId);
          await this.placements.decrementByLotAndLocation(tx, organizationId, {
            stockLotId: line.sourceLotId,
            warehouseId: line.warehouseId!,
            locationId: line.locationId ?? null,
            amount: baseQuantity,
          });
        }

        await tx.stockMovementLine.create({
          data: {
            organizationId,
            movementId,
            productId: product.id,
            effect: "OUTBOUND",
            sourceLotId: line.sourceLotId ?? null,
            sourceWarehouseId: line.warehouseId,
            sourceLocationId: line.locationId ?? null,
            uomCode: line.uomCode!,
            quantity: line.quantity,
            baseQuantity,
          },
        });

        await this.balances.decrementOnHand(tx, organizationId, {
          productId: product.id,
          warehouseId: line.warehouseId!,
          locationId: line.locationId ?? null,
          amount: baseQuantity,
        });
      }
    }
  }

  // ──────────────────────────────────────────────────────────
  // TRANSFER — effect: TRANSFER
  // ──────────────────────────────────────────────────────────
  private async executeTransfer(tx: TenantTransactionClient, organizationId: string, movementId: string, input: TransferInput) {
    for (const line of input.lines) {
      const destWarehouse = await this.warehouses.requireWarehouseTx(tx, organizationId, line.destWarehouseId);
      const destLocation = await this.requireOptionalLocationTx(tx, organizationId, line.destLocationId, line.destWarehouseId);
      this.assertDestinationActive(destWarehouse, destLocation);

      if (line.sourcePieceId) {
        const piece = await this.pieces.requireAvailablePieceTx(tx, organizationId, line.sourcePieceId);
        const product = await this.requireProductTx(tx, organizationId, piece.productId);
        const baseQuantity = await this.convertTx(
          tx,
          organizationId,
          product.id,
          piece.quantity.toFixed(3),
          piece.uomCode,
          product.baseUomCode
        );

        await this.pieces.moveLocationTx(
          tx,
          organizationId,
          piece.id,
          { warehouseId: piece.warehouseId, locationId: piece.locationId },
          { warehouseId: line.destWarehouseId, locationId: line.destLocationId ?? null }
        );

        await tx.stockMovementLine.create({
          data: {
            organizationId,
            movementId,
            productId: product.id,
            effect: "TRANSFER",
            sourcePieceId: piece.id,
            sourceWarehouseId: piece.warehouseId,
            sourceLocationId: piece.locationId,
            destWarehouseId: line.destWarehouseId,
            destLocationId: line.destLocationId ?? null,
            uomCode: piece.uomCode,
            quantity: piece.quantity,
            baseQuantity,
          },
        });

        await this.balances.decrementOnHand(tx, organizationId, {
          productId: product.id,
          warehouseId: piece.warehouseId,
          locationId: piece.locationId,
          amount: baseQuantity,
        });
        await this.balances.incrementOnHand(tx, organizationId, {
          productId: product.id,
          warehouseId: line.destWarehouseId,
          locationId: line.destLocationId ?? null,
          uomCode: product.baseUomCode,
          amount: baseQuantity,
        });
      } else {
        const product = await this.requireProductTx(tx, organizationId, line.productId!);
        await this.warehouses.requireWarehouseTx(tx, organizationId, line.sourceWarehouseId!);
        await this.requireOptionalLocationTx(tx, organizationId, line.sourceLocationId, line.sourceWarehouseId!);
        // Outbound source — inactive source warehouse/location is explicitly allowed.

        const baseQuantity = await this.convertTx(tx, organizationId, product.id, line.quantity!, line.uomCode!, product.baseUomCode);

        if (line.sourceLotId) {
          await this.lots.requireLotTx(tx, organizationId, line.sourceLotId);
          await this.placements.decrementByLotAndLocation(tx, organizationId, {
            stockLotId: line.sourceLotId,
            warehouseId: line.sourceWarehouseId!,
            locationId: line.sourceLocationId ?? null,
            amount: baseQuantity,
          });
          await this.placements.incrementOrCreatePlacement(tx, organizationId, {
            stockLotId: line.sourceLotId,
            productId: product.id,
            warehouseId: line.destWarehouseId,
            locationId: line.destLocationId ?? null,
            uomCode: product.baseUomCode,
            amount: baseQuantity,
          });
        }

        await tx.stockMovementLine.create({
          data: {
            organizationId,
            movementId,
            productId: product.id,
            effect: "TRANSFER",
            sourceLotId: line.sourceLotId ?? null,
            sourceWarehouseId: line.sourceWarehouseId,
            sourceLocationId: line.sourceLocationId ?? null,
            destWarehouseId: line.destWarehouseId,
            destLocationId: line.destLocationId ?? null,
            uomCode: line.uomCode!,
            quantity: line.quantity!,
            baseQuantity,
          },
        });

        await this.balances.decrementOnHand(tx, organizationId, {
          productId: product.id,
          warehouseId: line.sourceWarehouseId!,
          locationId: line.sourceLocationId ?? null,
          amount: baseQuantity,
        });
        await this.balances.incrementOnHand(tx, organizationId, {
          productId: product.id,
          warehouseId: line.destWarehouseId,
          locationId: line.destLocationId ?? null,
          uomCode: product.baseUomCode,
          amount: baseQuantity,
        });
      }
    }
  }

  // ──────────────────────────────────────────────────────────
  // ADJUSTMENT — effect: INBOUND (delta > 0) or OUTBOUND (delta < 0).
  // ADMIN-only, enforced by assertAuthorized before this ever runs.
  // ──────────────────────────────────────────────────────────
  private async executeAdjustment(tx: TenantTransactionClient, organizationId: string, movementId: string, input: AdjustmentInput) {
    for (const line of input.lines) {
      const product = await this.requireProductTx(tx, organizationId, line.productId);
      if (product.trackingMode === "PIECE") {
        throw new BadRequestException(
          `ADJUSTMENT is not supported for PIECE-tracked products (${product.sku}) — use SCRAP + RECEIPT for corrections`
        );
      }
      const warehouse = await this.warehouses.requireWarehouseTx(tx, organizationId, line.warehouseId);
      const location = await this.requireOptionalLocationTx(tx, organizationId, line.locationId, line.warehouseId);

      const delta = new Prisma.Decimal(line.delta);
      const isIncrease = delta.greaterThan(0);
      if (isIncrease) {
        this.assertDestinationActive(warehouse, location);
      }

      const absAmount = delta.abs().toFixed(3);
      const baseQuantity = await this.convertTx(tx, organizationId, product.id, absAmount, line.uomCode, product.baseUomCode);

      await tx.stockMovementLine.create({
        data: {
          organizationId,
          movementId,
          productId: product.id,
          effect: isIncrease ? "INBOUND" : "OUTBOUND",
          ...(isIncrease
            ? { destWarehouseId: line.warehouseId, destLocationId: line.locationId ?? null }
            : { sourceWarehouseId: line.warehouseId, sourceLocationId: line.locationId ?? null }),
          uomCode: line.uomCode,
          quantity: absAmount,
          baseQuantity,
        },
      });

      if (isIncrease) {
        await this.balances.incrementOnHand(tx, organizationId, {
          productId: product.id,
          warehouseId: line.warehouseId,
          locationId: line.locationId ?? null,
          uomCode: product.baseUomCode,
          amount: baseQuantity,
        });
      } else {
        await this.balances.decrementOnHand(tx, organizationId, {
          productId: product.id,
          warehouseId: line.warehouseId,
          locationId: line.locationId ?? null,
          amount: baseQuantity,
        });
      }
    }
  }

  // ──────────────────────────────────────────────────────────
  // SPLIT — effect: NONE. No Balance mutation, no UOM conversion, ever.
  // ──────────────────────────────────────────────────────────
  private async executeSplit(tx: TenantTransactionClient, organizationId: string, movementId: string, input: SplitInput) {
    for (const line of input.lines) {
      const parent = await this.pieces.requireAvailablePieceTx(tx, organizationId, line.sourcePieceId);
      const product = await this.requireProductTx(tx, organizationId, parent.productId);
      if (product.trackingMode !== "PIECE") {
        throw new BadRequestException("SPLIT is only valid for PIECE-tracked products");
      }

      const sum = line.children.reduce((acc, c) => acc.add(new Prisma.Decimal(c.quantity)), new Prisma.Decimal(0));
      if (!sum.equals(parent.quantity)) {
        throw new BadRequestException(
          `SPLIT children must sum exactly to the parent piece's quantity (expected ${parent.quantity.toFixed(3)}, got ${sum.toFixed(3)})`
        );
      }

      await this.pieces.transitionStatusTx(tx, organizationId, parent.id, "CONSUMED");

      for (const child of line.children) {
        const childPiece = await this.pieces.createChildTx(tx, organizationId, parent, child.quantity);
        await tx.stockMovementLine.create({
          data: {
            organizationId,
            movementId,
            productId: product.id,
            effect: "NONE",
            sourcePieceId: parent.id,
            destPieceId: childPiece.id,
            sourceWarehouseId: parent.warehouseId,
            sourceLocationId: parent.locationId,
            uomCode: parent.uomCode,
            quantity: child.quantity,
            baseQuantity: null,
          },
        });
      }
      // No StockBalance mutation — total physical quantity is unchanged by construction.
    }
  }

  // ──────────────────────────────────────────────────────────
  // Shared lookups / assertions
  // ──────────────────────────────────────────────────────────

  private async requireProductTx(tx: TenantTransactionClient, organizationId: string, id: string) {
    const product = await tx.product.findFirst({ where: { id, organizationId } });
    if (!product) throw new NotFoundException("Product not found");
    return product;
  }

  private async requireSupplierTx(tx: TenantTransactionClient, organizationId: string, id: string) {
    const supplier = await tx.supplier.findFirst({ where: { id, organizationId } });
    if (!supplier) throw new NotFoundException("Supplier not found");
    return supplier;
  }

  private async requireOptionalLocationTx(
    tx: TenantTransactionClient,
    organizationId: string,
    locationId: string | undefined,
    warehouseId: string
  ) {
    if (!locationId) return null;
    const location = await tx.location.findFirst({ where: { id: locationId, organizationId } });
    if (!location) throw new NotFoundException("Location not found");
    if (location.warehouseId !== warehouseId) {
      throw new BadRequestException("locationId does not belong to the given warehouseId");
    }
    return location;
  }

  private assertDestinationActive(warehouse: { active: boolean }, location: { active: boolean } | null): void {
    if (!warehouse.active) throw new BadRequestException("Cannot receive/transfer into an inactive warehouse");
    if (location && !location.active) throw new BadRequestException("Cannot receive/transfer into an inactive location");
  }

  private async convertTx(
    tx: TenantTransactionClient,
    organizationId: string,
    productId: string,
    quantity: string,
    fromUomCode: string,
    toUomCode: string
  ): Promise<string> {
    const result = await this.uomConversions.convert(
      organizationId,
      productId,
      { quantity, fromUomCode: fromUomCode as never, toUomCode: toUomCode as never },
      tx
    );
    return result.quantity;
  }

  private async loadSummary(organizationId: string, movementId: string): Promise<StockMovementSummary> {
    const movement = (await this.db.stockMovement.findFirst({
      where: { id: movementId, organizationId },
      include: { lines: true },
    })) as MovementWithLines | null;
    if (!movement) throw new NotFoundException("Movement not found");
    return toSummary(movement);
  }
}

function toListItem(movement: MovementListRow): StockMovementListItem {
  return {
    id: movement.id,
    type: movement.type as StockMovementType,
    referenceType: (movement.referenceType as StockMovementListItem["referenceType"]) ?? null,
    referenceId: movement.referenceId,
    actorUserId: movement.actorUserId,
    createdAt: movement.createdAt.toISOString(),
    lineCount: movement._count.lines,
  };
}

function toSummary(movement: MovementWithLines): StockMovementSummary {
  return {
    id: movement.id,
    type: movement.type as StockMovementType,
    referenceType: (movement.referenceType as StockMovementSummary["referenceType"]) ?? null,
    referenceId: movement.referenceId,
    idempotencyKey: movement.idempotencyKey,
    actorUserId: movement.actorUserId,
    reason: movement.reason,
    createdAt: movement.createdAt.toISOString(),
    lines: movement.lines.map(toLineSummary),
  };
}

function toLineSummary(line: MovementWithLines["lines"][number]): StockMovementLineSummary {
  return {
    id: line.id,
    movementId: line.movementId,
    productId: line.productId,
    effect: line.effect as StockMovementLineSummary["effect"],
    sourcePieceId: line.sourcePieceId,
    destPieceId: line.destPieceId,
    sourceLotId: line.sourceLotId,
    destLotId: line.destLotId,
    sourceWarehouseId: line.sourceWarehouseId,
    sourceLocationId: line.sourceLocationId,
    destWarehouseId: line.destWarehouseId,
    destLocationId: line.destLocationId,
    uomCode: line.uomCode as StockMovementLineSummary["uomCode"],
    quantity: line.quantity.toString(),
    baseQuantity: line.baseQuantity?.toString() ?? null,
  };
}
