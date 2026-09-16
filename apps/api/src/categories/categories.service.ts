import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@top/database";
import type { createTenantSafePrismaClient } from "@top/database";
import type { CreateCategoryInput, UpdateCategoryInput } from "@top/validation";
import type { CategorySummary } from "@top/types";
import { TENANT_PRISMA } from "../database/database.module";
import { AuditService } from "../common/audit/audit.service";

type TenantDb = ReturnType<typeof createTenantSafePrismaClient>;

/**
 * M3.2 (Architecture Gate Revision 1, R16/R20). The minimal CRUD gap-filler
 * for the pre-existing `Category` model (already shared by
 * PurchaseRequest.categoryId and SupplierCategory, which had zero API
 * before this). Reuses Category's existing `active` boolean as its only
 * lifecycle mechanism — no archive/status concept invented. No DELETE: a
 * real one would be blocked by SupplierCategory's own `ON DELETE RESTRICT`
 * FK the moment a category is actually used, so offering it would just be
 * an inconsistent "sometimes works" endpoint.
 */
@Injectable()
export class CategoriesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantDb,
    private readonly audit: AuditService
  ) {}

  async list(organizationId: string, includeInactive: boolean): Promise<CategorySummary[]> {
    const rows = await this.db.category.findMany({
      where: { organizationId, ...(includeInactive ? {} : { active: true }) },
      orderBy: { name: "asc" },
    });
    return rows.map((r) => ({ id: r.id, name: r.name, active: r.active }));
  }

  async create(organizationId: string, actorUserId: string, input: CreateCategoryInput): Promise<CategorySummary> {
    let category;
    try {
      category = await this.db.category.create({ data: { organizationId, name: input.name } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException("A category with this name already exists in your organization");
      }
      throw err;
    }

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: "CATEGORY_CREATED",
      entityType: "Category",
      entityId: category.id,
      newValue: { name: category.name },
    });

    return { id: category.id, name: category.name, active: category.active };
  }

  async update(organizationId: string, actorUserId: string, id: string, input: UpdateCategoryInput): Promise<CategorySummary> {
    const existing = await this.db.category.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundException("Category not found");

    const data: Prisma.CategoryUncheckedUpdateInput = {};
    const oldValue: Record<string, unknown> = {};
    const newValue: Record<string, unknown> = {};
    if (input.name !== undefined && input.name !== existing.name) {
      data.name = input.name;
      oldValue.name = existing.name;
      newValue.name = input.name;
    }
    if (input.active !== undefined && input.active !== existing.active) {
      data.active = input.active;
      oldValue.active = existing.active;
      newValue.active = input.active;
    }

    if (Object.keys(data).length === 0) return { id: existing.id, name: existing.name, active: existing.active };

    let category;
    try {
      category = await this.db.category.update({ where: { id }, data });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException("A category with this name already exists in your organization");
      }
      throw err;
    }

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: "CATEGORY_UPDATED",
      entityType: "Category",
      entityId: id,
      oldValue,
      newValue,
    });

    return { id: category.id, name: category.name, active: category.active };
  }
}
