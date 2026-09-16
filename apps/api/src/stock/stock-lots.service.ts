import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { createTenantSafePrismaClient } from "@top/database";
import type { TenantTransactionClient } from "../database/database.module";
import type { CreateStockLotInput, ListStockLotsQuery, UpdateStockLotInput } from "@top/validation";
import type { StockLotSummary } from "@top/types";
import { TENANT_PRISMA } from "../database/database.module";
import { AuditService } from "../common/audit/audit.service";

type TenantDb = ReturnType<typeof createTenantSafePrismaClient>;
type StockLotRow = Awaited<ReturnType<TenantDb["stockLot"]["create"]>>;

/**
 * M2.4-C: StockLot is physical batch IDENTITY only — no quantity, no
 * warehouseId/locationId (those live on StockLotPlacement). Creating or
 * updating a lot never touches StockBalance — there is no StockMovement yet,
 * so this is purely administrative record-keeping (same stance M2.4-B took
 * for StockBalance itself).
 */
@Injectable()
export class StockLotsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantDb,
    private readonly audit: AuditService
  ) {}

  async list(organizationId: string, query: ListStockLotsQuery): Promise<StockLotSummary[]> {
    const rows = await this.db.stockLot.findMany({
      where: {
        organizationId,
        ...(query.productId ? { productId: query.productId } : {}),
        ...(query.supplierId ? { supplierId: query.supplierId } : {}),
        ...(query.lotNumber ? { lotNumber: query.lotNumber } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toSummary);
  }

  async get(organizationId: string, id: string): Promise<StockLotSummary> {
    const row = await this.requireLot(organizationId, id);
    return toSummary(row);
  }

  async create(organizationId: string, actingUserId: string, input: CreateStockLotInput): Promise<StockLotSummary> {
    const product = await this.db.product.findFirst({ where: { id: input.productId, organizationId } });
    if (!product) throw new NotFoundException("Product not found");

    if (input.supplierId) {
      const supplier = await this.db.supplier.findFirst({ where: { id: input.supplierId, organizationId } });
      if (!supplier) throw new NotFoundException("Supplier not found");
    }

    const lot = await this.db.stockLot.create({
      data: {
        organizationId,
        productId: input.productId,
        supplierId: input.supplierId ?? null,
        lotNumber: input.lotNumber ?? null,
        receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(),
      },
    });

    await this.audit.log({
      organizationId,
      userId: actingUserId,
      action: "STOCK_LOT_CREATED",
      entityType: "StockLot",
      entityId: lot.id,
      newValue: { productId: lot.productId, supplierId: lot.supplierId, lotNumber: lot.lotNumber },
    });

    return toSummary(lot);
  }

  async update(
    organizationId: string,
    actingUserId: string,
    id: string,
    input: UpdateStockLotInput
  ): Promise<StockLotSummary> {
    const existing = await this.requireLot(organizationId, id);

    if (input.supplierId) {
      const supplier = await this.db.supplier.findFirst({ where: { id: input.supplierId, organizationId } });
      if (!supplier) throw new NotFoundException("Supplier not found");
    }

    const lot = await this.db.stockLot.update({
      where: { id },
      data: {
        supplierId: input.supplierId === undefined ? undefined : input.supplierId,
        lotNumber: input.lotNumber === undefined ? undefined : input.lotNumber,
        receivedAt: input.receivedAt ? new Date(input.receivedAt) : undefined,
      },
    });

    await this.audit.log({
      organizationId,
      userId: actingUserId,
      action: "STOCK_LOT_UPDATED",
      entityType: "StockLot",
      entityId: id,
      oldValue: { supplierId: existing.supplierId, lotNumber: existing.lotNumber },
      newValue: { supplierId: lot.supplierId, lotNumber: lot.lotNumber },
    });

    return toSummary(lot);
  }

  /** Public — also used by StockLotPlacementsService as the tenant-ownership check on :stockLotId. */
  async requireLot(organizationId: string, id: string): Promise<StockLotRow> {
    const lot = await this.db.stockLot.findFirst({ where: { id, organizationId } });
    if (!lot) throw new NotFoundException("Stock lot not found");
    return lot;
  }

  /** M2.5 (Phase F) — transaction-participating counterpart to requireLot, for StockMovementsService. */
  async requireLotTx(tx: TenantTransactionClient, organizationId: string, id: string): Promise<StockLotRow> {
    const lot = await tx.stockLot.findFirst({ where: { id, organizationId } });
    if (!lot) throw new NotFoundException("Stock lot not found");
    return lot;
  }
}

function toSummary(row: StockLotRow): StockLotSummary {
  return {
    id: row.id,
    productId: row.productId,
    supplierId: row.supplierId,
    lotNumber: row.lotNumber,
    receivedAt: row.receivedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
