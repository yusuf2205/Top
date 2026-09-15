import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@top/database";
import type { createTenantSafePrismaClient } from "@top/database";
import type { CreateWarehouseInput, UpdateWarehouseInput } from "@top/validation";
import type { WarehouseSummary } from "@top/types";
import { TENANT_PRISMA } from "../database/database.module";
import { AuditService } from "../common/audit/audit.service";

type TenantDb = ReturnType<typeof createTenantSafePrismaClient>;
type WarehouseRow = Awaited<ReturnType<TenantDb["warehouse"]["create"]>>;

@Injectable()
export class WarehousesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantDb,
    private readonly audit: AuditService
  ) {}

  async list(organizationId: string): Promise<WarehouseSummary[]> {
    const rows = await this.db.warehouse.findMany({ where: { organizationId }, orderBy: { code: "asc" } });
    return rows.map(toSummary);
  }

  async get(organizationId: string, id: string): Promise<WarehouseSummary> {
    const warehouse = await this.requireWarehouse(organizationId, id);
    return toSummary(warehouse);
  }

  async create(organizationId: string, actingUserId: string, input: CreateWarehouseInput): Promise<WarehouseSummary> {
    let warehouse: WarehouseRow;
    try {
      warehouse = await this.db.warehouse.create({
        data: {
          organizationId,
          code: normalizeCode(input.code),
          name: input.name,
          description: input.description ?? null,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException("A warehouse with this code already exists in your organization");
      }
      throw err;
    }

    await this.audit.log({
      organizationId,
      userId: actingUserId,
      action: "WAREHOUSE_CREATED",
      entityType: "Warehouse",
      entityId: warehouse.id,
      newValue: { code: warehouse.code, name: warehouse.name },
    });

    return toSummary(warehouse);
  }

  async update(
    organizationId: string,
    actingUserId: string,
    id: string,
    input: UpdateWarehouseInput
  ): Promise<WarehouseSummary> {
    const existing = await this.requireWarehouse(organizationId, id);

    let warehouse: WarehouseRow;
    try {
      warehouse = await this.db.warehouse.update({
        where: { id },
        data: {
          code: input.code ? normalizeCode(input.code) : undefined,
          name: input.name,
          description: input.description,
          active: input.active,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException("A warehouse with this code already exists in your organization");
      }
      throw err;
    }

    await this.audit.log({
      organizationId,
      userId: actingUserId,
      action: "WAREHOUSE_UPDATED",
      entityType: "Warehouse",
      entityId: id,
      oldValue: { code: existing.code, name: existing.name, active: existing.active },
      newValue: { code: warehouse.code, name: warehouse.name, active: warehouse.active },
    });

    return toSummary(warehouse);
  }

  /**
   * Cross-tenant ownership check — used directly (GET/:id, PATCH/:id) and by
   * LocationsService before trusting a :warehouseId route param (same
   * requireX pattern as ProductsService.requireProduct /
   * UomConversionsService.requireProduct). Also the enforcement point for
   * "a Location's warehouseId must belong to the same organizationId as the
   * caller" from the M2.4-A approval's composition-check requirement.
   */
  async requireWarehouse(organizationId: string, id: string): Promise<WarehouseRow> {
    const warehouse = await this.db.warehouse.findFirst({ where: { id, organizationId } });
    if (!warehouse) throw new NotFoundException("Warehouse not found");
    return warehouse;
  }
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function toSummary(warehouse: WarehouseRow): WarehouseSummary {
  return {
    id: warehouse.id,
    code: warehouse.code,
    name: warehouse.name,
    description: warehouse.description,
    active: warehouse.active,
    createdAt: warehouse.createdAt.toISOString(),
    updatedAt: warehouse.updatedAt.toISOString(),
  };
}
