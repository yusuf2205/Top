import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { createTenantSafePrismaClient } from "@top/database";
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
