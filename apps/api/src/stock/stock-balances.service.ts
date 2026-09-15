import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@top/database";
import type { createTenantSafePrismaClient } from "@top/database";
import type { CreateStockBalanceInput, ListStockBalancesQuery, UpdateStockBalanceInput } from "@top/validation";
import type { StockBalanceSummary } from "@top/types";
import { TENANT_PRISMA } from "../database/database.module";
import { AuditService } from "../common/audit/audit.service";
import { WarehousesService } from "../warehouses/warehouses.service";

type TenantDb = ReturnType<typeof createTenantSafePrismaClient>;
type StockBalanceRow = Awaited<ReturnType<TenantDb["stockBalance"]["create"]>>;

/**
 * M2.4-B: safe storage for the current aggregated stock state only — no
 * receive/issue/transfer/adjust logic here (that needs StockMovement, a
 * separate not-yet-approved slice). No concurrency handling either
 * (explicitly deferred): CRUD here is administrative record-keeping, not a
 * transactional inventory operation.
 */
@Injectable()
export class StockBalancesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly warehouses: WarehousesService
  ) {}

  async list(organizationId: string, query: ListStockBalancesQuery): Promise<StockBalanceSummary[]> {
    const where: Prisma.StockBalanceWhereInput = {
      organizationId,
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.locationId ? { locationId: query.locationId } : {}),
    };
    const rows = await this.db.stockBalance.findMany({ where, orderBy: { createdAt: "asc" } });
    return rows.map(toSummary);
  }

  async get(organizationId: string, id: string): Promise<StockBalanceSummary> {
    const row = await this.requireBalance(organizationId, id);
    return toSummary(row);
  }

  async create(
    organizationId: string,
    actingUserId: string,
    input: CreateStockBalanceInput
  ): Promise<StockBalanceSummary> {
    const product = await this.db.product.findFirst({ where: { id: input.productId, organizationId } });
    if (!product) throw new NotFoundException("Product not found");

    // Hard rule (M2.4-B §3): StockBalance never stores an arbitrary UOM —
    // it is always exactly Product.baseUomCode. No density/geometry/hardcoded
    // kg<->m conversion is ever consulted here; a mismatch is a controlled
    // business error, not an auto-fix.
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

    const onHandQty = input.onHandQty ?? "0";
    const reservedQty = input.reservedQty ?? "0";
    assertReservedNotExceedOnHand(onHandQty, reservedQty);

    let balance: StockBalanceRow;
    try {
      balance = await this.db.stockBalance.create({
        data: {
          organizationId,
          productId: input.productId,
          warehouseId: input.warehouseId,
          locationId: input.locationId ?? null,
          uomCode: input.uomCode,
          onHandQty,
          reservedQty,
        },
      });
    } catch (err) {
      throw mapWriteError(err);
    }

    await this.audit.log({
      organizationId,
      userId: actingUserId,
      action: "STOCK_BALANCE_CREATED",
      entityType: "StockBalance",
      entityId: balance.id,
      newValue: {
        productId: balance.productId,
        warehouseId: balance.warehouseId,
        locationId: balance.locationId,
        onHandQty: balance.onHandQty.toString(),
        reservedQty: balance.reservedQty.toString(),
      },
    });

    return toSummary(balance);
  }

  async update(
    organizationId: string,
    actingUserId: string,
    id: string,
    input: UpdateStockBalanceInput
  ): Promise<StockBalanceSummary> {
    const existing = await this.requireBalance(organizationId, id);

    const onHandQty = input.onHandQty ?? existing.onHandQty.toString();
    const reservedQty = input.reservedQty ?? existing.reservedQty.toString();
    assertReservedNotExceedOnHand(onHandQty, reservedQty);

    let balance: StockBalanceRow;
    try {
      balance = await this.db.stockBalance.update({ where: { id }, data: { onHandQty, reservedQty } });
    } catch (err) {
      throw mapWriteError(err);
    }

    await this.audit.log({
      organizationId,
      userId: actingUserId,
      action: "STOCK_BALANCE_UPDATED",
      entityType: "StockBalance",
      entityId: id,
      oldValue: { onHandQty: existing.onHandQty.toString(), reservedQty: existing.reservedQty.toString() },
      newValue: { onHandQty: balance.onHandQty.toString(), reservedQty: balance.reservedQty.toString() },
    });

    return toSummary(balance);
  }

  private async requireBalance(organizationId: string, id: string): Promise<StockBalanceRow> {
    const row = await this.db.stockBalance.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundException("Stock balance not found");
    return row;
  }
}

function assertReservedNotExceedOnHand(onHandQty: string, reservedQty: string): void {
  if (new Prisma.Decimal(reservedQty).greaterThan(new Prisma.Decimal(onHandQty))) {
    throw new BadRequestException("reservedQty cannot exceed onHandQty");
  }
}

/** P2002: one of the two partial unique indexes (product+warehouse[+location]). P2004: the DB CHECK backstop (defense-in-depth; the service already validates both invariants before ever reaching the DB). */
function mapWriteError(err: unknown): Error {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return new ConflictException("A stock balance already exists for this product/warehouse/location combination");
    }
    if (err.code === "P2004") {
      return new BadRequestException("Quantity constraint violated (negative or reservedQty > onHandQty)");
    }
  }
  return err as Error;
}

function toSummary(row: StockBalanceRow): StockBalanceSummary {
  return {
    id: row.id,
    productId: row.productId,
    warehouseId: row.warehouseId,
    locationId: row.locationId,
    uomCode: row.uomCode as StockBalanceSummary["uomCode"],
    onHandQty: row.onHandQty.toString(),
    reservedQty: row.reservedQty.toString(),
    availableQty: row.onHandQty.sub(row.reservedQty).toString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
