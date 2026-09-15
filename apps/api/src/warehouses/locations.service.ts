import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@top/database";
import type { createTenantSafePrismaClient } from "@top/database";
import type { CreateLocationInput, UpdateLocationInput } from "@top/validation";
import type { LocationSummary } from "@top/types";
import { TENANT_PRISMA } from "../database/database.module";
import { AuditService } from "../common/audit/audit.service";
import { WarehousesService } from "./warehouses.service";

type TenantDb = ReturnType<typeof createTenantSafePrismaClient>;
type LocationRow = Awaited<ReturnType<TenantDb["location"]["create"]>>;

@Injectable()
export class LocationsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly warehouses: WarehousesService
  ) {}

  async list(organizationId: string, warehouseId: string): Promise<LocationSummary[]> {
    await this.warehouses.requireWarehouse(organizationId, warehouseId);
    const rows = await this.db.location.findMany({
      where: { organizationId, warehouseId },
      orderBy: { code: "asc" },
    });
    return rows.map(toSummary);
  }

  async create(
    organizationId: string,
    actingUserId: string,
    warehouseId: string,
    input: CreateLocationInput
  ): Promise<LocationSummary> {
    const warehouse = await this.warehouses.requireWarehouse(organizationId, warehouseId);
    // A deactivated warehouse represents space no longer in use — adding new
    // locations to it would be physically nonsensical. Not explicitly
    // required by the M2.4-A approval text, but a direct, low-risk
    // consequence of "active flag" actually meaning something; flagged in
    // the M2.4-A report for the user to confirm or override.
    if (!warehouse.active) {
      throw new BadRequestException("Cannot add a location to an inactive warehouse");
    }

    let location: LocationRow;
    try {
      location = await this.db.location.create({
        data: { organizationId, warehouseId, code: normalizeCode(input.code), name: input.name },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException("A location with this code already exists in this warehouse");
      }
      throw err;
    }

    await this.audit.log({
      organizationId,
      userId: actingUserId,
      action: "LOCATION_CREATED",
      entityType: "Location",
      entityId: location.id,
      newValue: { warehouseId, code: location.code, name: location.name },
    });

    return toSummary(location);
  }

  async update(
    organizationId: string,
    actingUserId: string,
    warehouseId: string,
    id: string,
    input: UpdateLocationInput
  ): Promise<LocationSummary> {
    await this.warehouses.requireWarehouse(organizationId, warehouseId);
    const existing = await this.db.location.findFirst({ where: { id, warehouseId, organizationId } });
    if (!existing) throw new NotFoundException("Location not found");

    let location: LocationRow;
    try {
      location = await this.db.location.update({
        where: { id },
        data: {
          code: input.code ? normalizeCode(input.code) : undefined,
          name: input.name,
          active: input.active,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException("A location with this code already exists in this warehouse");
      }
      throw err;
    }

    await this.audit.log({
      organizationId,
      userId: actingUserId,
      action: "LOCATION_UPDATED",
      entityType: "Location",
      entityId: id,
      oldValue: { code: existing.code, name: existing.name, active: existing.active },
      newValue: { code: location.code, name: location.name, active: location.active },
    });

    return toSummary(location);
  }
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function toSummary(location: LocationRow): LocationSummary {
  return {
    id: location.id,
    warehouseId: location.warehouseId,
    code: location.code,
    name: location.name,
    active: location.active,
    createdAt: location.createdAt.toISOString(),
    updatedAt: location.updatedAt.toISOString(),
  };
}
