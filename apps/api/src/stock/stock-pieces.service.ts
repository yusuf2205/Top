import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { createTenantSafePrismaClient } from "@top/database";
import type { TenantTransactionClient } from "../database/database.module";
import type { CreateStockPieceInput, ListStockPiecesQuery } from "@top/validation";
import type { StockPieceSummary } from "@top/types";
import { TENANT_PRISMA } from "../database/database.module";
import { AuditService } from "../common/audit/audit.service";
import { WarehousesService } from "../warehouses/warehouses.service";
import { StockLotsService } from "./stock-lots.service";

type TenantDb = ReturnType<typeof createTenantSafePrismaClient>;
type PieceRow = Awaited<ReturnType<TenantDb["stockPiece"]["create"]>>;

/**
 * M2.4-D (final, approved with changes): CRUD/read only — create + list +
 * get. No PATCH (a piece's quantity/status are part of its physical
 * identity/history, not administrative fields), no DELETE, no
 * parentPieceId on create (only a future atomic split/issue operation may
 * write lineage — creating a child independently here would let a remnant
 * exist while its parent stays AVAILABLE, silently duplicating physical
 * quantity), no StockBalance/StockLotPlacement synchronization.
 */
@Injectable()
export class StockPiecesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly stockLots: StockLotsService,
    private readonly warehouses: WarehousesService
  ) {}

  async list(organizationId: string, query: ListStockPiecesQuery): Promise<StockPieceSummary[]> {
    const rows = await this.db.stockPiece.findMany({
      where: {
        organizationId,
        ...(query.lotId ? { lotId: query.lotId } : {}),
        ...(query.productId ? { productId: query.productId } : {}),
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        ...(query.locationId ? { locationId: query.locationId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toSummary);
  }

  async get(organizationId: string, id: string): Promise<StockPieceSummary> {
    const row = await this.requirePiece(organizationId, id);
    return toSummary(row);
  }

  async create(
    organizationId: string,
    actingUserId: string,
    input: CreateStockPieceInput
  ): Promise<StockPieceSummary> {
    const lot = await this.stockLots.requireLot(organizationId, input.lotId);

    // productId is never accepted from the client (not a field on
    // CreateStockPieceInput at all) — always derived from the already
    // tenant-checked lot, same pattern as StockLotPlacement.
    const product = await this.db.product.findFirst({ where: { id: lot.productId, organizationId } });
    if (!product) throw new NotFoundException("Product not found");

    if (product.trackingMode !== "PIECE") {
      throw new BadRequestException("StockPiece can only be created for products with trackingMode=PIECE");
    }

    await this.warehouses.requireWarehouse(organizationId, input.warehouseId);

    if (input.locationId) {
      const location = await this.db.location.findFirst({ where: { id: input.locationId, organizationId } });
      if (!location) throw new NotFoundException("Location not found");
      if (location.warehouseId !== input.warehouseId) {
        throw new BadRequestException("locationId does not belong to the given warehouseId");
      }
    }

    const piece = await this.db.stockPiece.create({
      data: {
        organizationId,
        productId: lot.productId,
        lotId: input.lotId,
        warehouseId: input.warehouseId,
        locationId: input.locationId ?? null,
        quantity: input.quantity,
        uomCode: input.uomCode,
        // status defaults to AVAILABLE (schema default); parentPieceId is
        // never set here (defaults to null) — see class doc comment.
      },
    });

    await this.audit.log({
      organizationId,
      userId: actingUserId,
      action: "STOCK_PIECE_CREATED",
      entityType: "StockPiece",
      entityId: piece.id,
      newValue: {
        lotId: piece.lotId,
        warehouseId: piece.warehouseId,
        locationId: piece.locationId,
        quantity: piece.quantity.toString(),
        uomCode: piece.uomCode,
      },
    });

    return toSummary(piece);
  }

  private async requirePiece(organizationId: string, id: string): Promise<PieceRow> {
    const row = await this.db.stockPiece.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundException("Stock piece not found");
    return row;
  }

  // ──────────────────────────────────────────────────────────
  // M2.5 (Architecture Gate Revision 2, Phase E) — transaction-safe
  // concurrency helpers for a FUTURE StockMovementsService. Same
  // `tx`-parameterized, no-`this.db` discipline as the other Phase E
  // helpers. `StockPiece.quantity` is NEVER mutated by anything here — it
  // remains immutable after creation, exactly as locked in M2.4-D; a
  // "decrease" is always represented by transitioning the original piece to
  // a terminal status and creating a smaller remnant child (createChild),
  // never by rewriting the original row's quantity. parentPieceId/
  // productId/lotId/uomCode on a child are always derived from the parent
  // row passed in — never a caller-supplied override — preserving
  // server-controlled lineage.
  // ──────────────────────────────────────────────────────────

  /**
   * Loads a piece and verifies it is AVAILABLE — the shared pre-check every
   * consuming operation (ISSUE/SCRAP/SPLIT/TRANSFER) performs before
   * attempting its own atomic transition below. This read alone does NOT
   * guarantee atomicity against a concurrent transition (another request
   * could transition the piece between this read and a later write) — the
   * actual concurrency guarantee comes from transitionStatus/moveLocation's
   * own conditional UPDATE, which re-checks status atomically at write
   * time. This method exists to fail fast with a clear 404/409 and to hand
   * the caller the row's current fields (productId/lotId/uomCode/quantity)
   * needed to build the rest of a movement line.
   */
  async requireAvailablePieceTx(tx: TenantTransactionClient, organizationId: string, id: string): Promise<PieceRow> {
    const piece = await tx.stockPiece.findFirst({ where: { id, organizationId } });
    if (!piece) throw new NotFoundException("Stock piece not found");
    if (piece.status !== "AVAILABLE") throw new ConflictException("Piece is not available");
    return piece;
  }

  /**
   * Conditional atomic status transition, AVAILABLE -> target. The sole
   * safe consumption/scrap/split guard under concurrency (Architecture Gate
   * §17): Postgres locks the row at UPDATE time, so a losing concurrent
   * caller's `WHERE status = 'AVAILABLE'` re-evaluates against the
   * already-transitioned row and matches zero rows — `count !== 1` is the
   * only signal needed to detect "someone else got here first" (or "this
   * piece was never AVAILABLE to begin with"), both correctly resulting in
   * a 409. This is also the sole mechanism preventing any illegal
   * transition: the guard only ever matches a row currently AVAILABLE, so
   * a transition attempted on a CONSUMED/SCRAPPED/RESERVED piece always
   * fails safely regardless of the requested target.
   */
  async transitionStatusTx(
    tx: TenantTransactionClient,
    organizationId: string,
    id: string,
    target: "CONSUMED" | "SCRAPPED"
  ): Promise<void> {
    const result = await tx.stockPiece.updateMany({
      where: { id, organizationId, status: "AVAILABLE" },
      data: { status: target },
    });
    if (result.count !== 1) {
      throw new ConflictException("Piece is no longer available");
    }
  }

  /**
   * Conditional atomic location transition for TRANSFER — guards on the
   * expected CURRENT (warehouseId, locationId) in addition to AVAILABLE
   * status, so two concurrent transfers of the same piece to different
   * destinations fail safely (whichever UPDATE's WHERE still matches the
   * pre-transfer location wins; the other matches zero rows once the first
   * commits). productId/lotId/uomCode/quantity/parentPieceId are
   * untouched — this is the one narrow, explicit exception to "StockPiece
   * is otherwise immutable once created" (Architecture Gate §20): only
   * location fields ever change, and only via this exact guarded path.
   */
  async moveLocationTx(
    tx: TenantTransactionClient,
    organizationId: string,
    id: string,
    expected: { warehouseId: string; locationId: string | null },
    next: { warehouseId: string; locationId: string | null }
  ): Promise<void> {
    const result = await tx.stockPiece.updateMany({
      where: {
        id,
        organizationId,
        status: "AVAILABLE",
        warehouseId: expected.warehouseId,
        locationId: expected.locationId,
      },
      data: { warehouseId: next.warehouseId, locationId: next.locationId },
    });
    if (result.count !== 1) {
      throw new ConflictException("Piece is no longer available at the expected location");
    }
  }

  /**
   * Creates a child/remnant piece from an already-loaded parent row.
   * productId/lotId/warehouseId/locationId/uomCode are always copied from
   * `parent` (the row the caller already fetched/validated) — never
   * accepted as separate parameters a caller could diverge from the
   * parent's own truth. `parentPieceId` is always `parent.id`; a client can
   * never supply or override it (same rule as M2.4-D's create endpoint).
   * Does not itself transition the parent — callers combine this with
   * transitionStatusTx on the parent in the same transaction (partial
   * ISSUE/SCRAP/SPLIT all follow this two-call shape).
   */
  async createChildTx(tx: TenantTransactionClient, organizationId: string, parent: PieceRow, quantity: string): Promise<PieceRow> {
    return await tx.stockPiece.create({
      data: {
        organizationId,
        productId: parent.productId,
        lotId: parent.lotId,
        warehouseId: parent.warehouseId,
        locationId: parent.locationId,
        uomCode: parent.uomCode,
        quantity,
        parentPieceId: parent.id,
      },
    });
  }
}

function toSummary(row: PieceRow): StockPieceSummary {
  return {
    id: row.id,
    productId: row.productId,
    lotId: row.lotId,
    warehouseId: row.warehouseId,
    locationId: row.locationId,
    parentPieceId: row.parentPieceId,
    quantity: row.quantity.toString(),
    uomCode: row.uomCode as StockPieceSummary["uomCode"],
    status: row.status as StockPieceSummary["status"],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
