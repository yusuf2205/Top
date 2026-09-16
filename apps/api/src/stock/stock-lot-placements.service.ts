import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@top/database";
import type { createTenantSafePrismaClient } from "@top/database";
import type {
  CreateStockLotPlacementInput,
  ListStockLotPlacementsQuery,
  UpdateStockLotPlacementInput,
} from "@top/validation";
import type { StockLotPlacementSummary } from "@top/types";
import { TENANT_PRISMA, type TenantTransactionClient } from "../database/database.module";
import { AuditService } from "../common/audit/audit.service";
import { WarehousesService } from "../warehouses/warehouses.service";
import { StockLotsService } from "./stock-lots.service";

type TenantDb = ReturnType<typeof createTenantSafePrismaClient>;
type PlacementRow = Awaited<ReturnType<TenantDb["stockLotPlacement"]["create"]>>;

/**
 * M2.4-C: StockLotPlacement is WHERE part of a lot physically sits. CRITICAL:
 * this service NEVER touches StockBalance — there is no StockMovement yet,
 * so placement CRUD and balance CRUD remain independent administrative
 * records. Before StockMovement exists, the system does not guarantee
 * automatic real-time synchronization between StockLotPlacement and
 * StockBalance.
 */
@Injectable()
export class StockLotPlacementsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly stockLots: StockLotsService,
    private readonly warehouses: WarehousesService
  ) {}

  async list(
    organizationId: string,
    stockLotId: string,
    query: ListStockLotPlacementsQuery
  ): Promise<StockLotPlacementSummary[]> {
    await this.stockLots.requireLot(organizationId, stockLotId);
    const rows = await this.db.stockLotPlacement.findMany({
      where: {
        organizationId,
        stockLotId,
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        ...(query.locationId ? { locationId: query.locationId } : {}),
      },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toSummary);
  }

  async get(organizationId: string, stockLotId: string, id: string): Promise<StockLotPlacementSummary> {
    await this.stockLots.requireLot(organizationId, stockLotId);
    const row = await this.requirePlacement(organizationId, stockLotId, id);
    return toSummary(row);
  }

  async create(
    organizationId: string,
    actingUserId: string,
    stockLotId: string,
    input: CreateStockLotPlacementInput
  ): Promise<StockLotPlacementSummary> {
    const lot = await this.stockLots.requireLot(organizationId, stockLotId);

    // productId is never accepted from the client (not a field on
    // CreateStockLotPlacementInput at all) — always derived from the
    // already tenant-checked lot.
    const product = await this.db.product.findFirst({ where: { id: lot.productId, organizationId } });
    if (!product) throw new NotFoundException("Product not found");

    if (input.uomCode !== product.baseUomCode) {
      throw new BadRequestException("uomCode must match the product's base UOM");
    }

    await this.warehouses.requireWarehouse(organizationId, input.warehouseId);

    if (input.locationId) {
      const location = await this.db.location.findFirst({ where: { id: input.locationId, organizationId } });
      if (!location) throw new NotFoundException("Location not found");
      if (location.warehouseId !== input.warehouseId) {
        throw new BadRequestException("locationId does not belong to the given warehouseId");
      }
    }

    const quantity = input.quantity ?? "0";

    let placement: PlacementRow;
    try {
      placement = await this.db.stockLotPlacement.create({
        data: {
          organizationId,
          stockLotId,
          productId: lot.productId,
          warehouseId: input.warehouseId,
          locationId: input.locationId ?? null,
          uomCode: input.uomCode,
          quantity,
        },
      });
    } catch (err) {
      throw mapWriteError(err);
    }

    await this.audit.log({
      organizationId,
      userId: actingUserId,
      action: "STOCK_LOT_PLACEMENT_CREATED",
      entityType: "StockLotPlacement",
      entityId: placement.id,
      newValue: {
        stockLotId,
        warehouseId: placement.warehouseId,
        locationId: placement.locationId,
        quantity: placement.quantity.toString(),
      },
    });

    return toSummary(placement);
  }

  async update(
    organizationId: string,
    actingUserId: string,
    stockLotId: string,
    id: string,
    input: UpdateStockLotPlacementInput
  ): Promise<StockLotPlacementSummary> {
    await this.stockLots.requireLot(organizationId, stockLotId);
    const existing = await this.requirePlacement(organizationId, stockLotId, id);

    const quantity = input.quantity ?? existing.quantity.toString();

    let placement: PlacementRow;
    try {
      placement = await this.db.stockLotPlacement.update({ where: { id }, data: { quantity } });
    } catch (err) {
      throw mapWriteError(err);
    }

    await this.audit.log({
      organizationId,
      userId: actingUserId,
      action: "STOCK_LOT_PLACEMENT_UPDATED",
      entityType: "StockLotPlacement",
      entityId: id,
      oldValue: { quantity: existing.quantity.toString() },
      newValue: { quantity: placement.quantity.toString() },
    });

    return toSummary(placement);
  }

  private async requirePlacement(organizationId: string, stockLotId: string, id: string): Promise<PlacementRow> {
    const row = await this.db.stockLotPlacement.findFirst({ where: { id, stockLotId, organizationId } });
    if (!row) throw new NotFoundException("Stock lot placement not found");
    return row;
  }

  // ──────────────────────────────────────────────────────────
  // M2.5 (Architecture Gate Revision 2, Phase E) — transaction-safe
  // concurrency helpers for a FUTURE StockMovementsService. Same
  // `tx`-parameterized, no-`this.db` discipline as StockBalancesService's
  // Phase E additions. No StockBalance synchronization here — a future
  // orchestrator calls the matching StockBalancesService helper separately,
  // in the same transaction.
  // ──────────────────────────────────────────────────────────

  /**
   * Conditional atomic decrement by (stockLotId, warehouseId, locationId) —
   * the shape a future ISSUE/TRANSFER-source caller actually has from its
   * DTO (a lot id + location, not a placement row id). Same atomic
   * check-and-write pattern as StockBalancesService.decrementOnHand. Never
   * deletes a zero-quantity placement (Architecture Gate §19) — the row
   * simply reaches quantity=0 and stays.
   */
  async decrementByLotAndLocation(
    tx: TenantTransactionClient,
    organizationId: string,
    params: { stockLotId: string; warehouseId: string; locationId: string | null; amount: string }
  ): Promise<void> {
    const result = await tx.stockLotPlacement.updateMany({
      where: {
        organizationId,
        stockLotId: params.stockLotId,
        warehouseId: params.warehouseId,
        locationId: params.locationId,
        quantity: { gte: params.amount },
      },
      data: { quantity: { decrement: params.amount } },
    });
    if (result.count !== 1) {
      throw new ConflictException("Insufficient placement quantity for this lot/warehouse/location");
    }
  }

  /**
   * Atomic increment, transparently creating the placement row if this is
   * the first time this lot has been placed at this (warehouse, location).
   * Same manual try-update/fallback-create pattern as
   * StockBalancesService.incrementOnHand, for the identical reason: this
   * table's uniqueness is two hand-written partial indexes, not a
   * declarative `@@unique` Prisma's `upsert` could target directly. Same
   * StockLot identity throughout — this never creates a new StockLot, only
   * a new/updated placement of the existing one (Architecture Gate §11:
   * transfer/receipt-into-existing-lot never fabricates a second lot).
   *
   * A `create()` P2002 (lost the race to a concurrent first-writer) is
   * deliberately left UNCAUGHT — see StockBalancesService.incrementOnHand's
   * doc comment for why an in-transaction catch-and-retry-via-update is
   * unsafe (confirmed empirically: Postgres aborts the whole transaction
   * after the failed `create`, so any further statement on it fails with
   * 25P02). The caller retries the whole `$transaction(...)` boundary.
   */
  async incrementOrCreatePlacement(
    tx: TenantTransactionClient,
    organizationId: string,
    params: { stockLotId: string; productId: string; warehouseId: string; locationId: string | null; uomCode: string; amount: string }
  ): Promise<PlacementRow> {
    const where = {
      organizationId,
      stockLotId: params.stockLotId,
      warehouseId: params.warehouseId,
      locationId: params.locationId,
    };

    const updated = await tx.stockLotPlacement.updateMany({ where, data: { quantity: { increment: params.amount } } });
    if (updated.count === 1) {
      return await tx.stockLotPlacement.findFirstOrThrow({ where });
    }

    return await tx.stockLotPlacement.create({
      data: {
        organizationId,
        stockLotId: params.stockLotId,
        productId: params.productId,
        warehouseId: params.warehouseId,
        locationId: params.locationId,
        uomCode: params.uomCode as PlacementRow["uomCode"],
        quantity: params.amount,
      },
    });
  }

  /** Tx-aware ownership-checked lookup — the transaction-participating counterpart to the private `requirePlacement` above (kept separate rather than merged, since that one intentionally stays tied to `this.db` for the existing non-transactional CRUD paths). */
  async requirePlacementTx(tx: TenantTransactionClient, organizationId: string, id: string): Promise<PlacementRow> {
    const row = await tx.stockLotPlacement.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundException("Stock lot placement not found");
    return row;
  }
}

/** P2002: one of the two partial unique indexes (lot+warehouse[+location]). P2004: the DB CHECK backstop. */
function mapWriteError(err: unknown): Error {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return new ConflictException("A placement already exists for this lot at this warehouse/location");
    }
    if (err.code === "P2004") {
      return new BadRequestException("Quantity constraint violated (negative quantity)");
    }
  }
  return err as Error;
}

function toSummary(row: PlacementRow): StockLotPlacementSummary {
  return {
    id: row.id,
    stockLotId: row.stockLotId,
    productId: row.productId,
    warehouseId: row.warehouseId,
    locationId: row.locationId,
    uomCode: row.uomCode as StockLotPlacementSummary["uomCode"],
    quantity: row.quantity.toString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
