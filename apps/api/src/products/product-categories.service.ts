import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { createTenantSafePrismaClient } from "@top/database";
import type { CreateProductCategoryInput, UpdateProductCategoryInput } from "@top/validation";
import type { ProductCategorySummary } from "@top/types";
import { TENANT_PRISMA } from "../database/database.module";
import { AuditService } from "../common/audit/audit.service";

type TenantDb = ReturnType<typeof createTenantSafePrismaClient>;

const MAX_TREE_DEPTH = 100;

@Injectable()
export class ProductCategoriesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantDb,
    private readonly audit: AuditService
  ) {}

  async list(organizationId: string): Promise<ProductCategorySummary[]> {
    const categories = await this.db.productCategory.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
    });
    return categories.map(toSummary);
  }

  async create(
    organizationId: string,
    actingUserId: string,
    input: CreateProductCategoryInput
  ): Promise<ProductCategorySummary> {
    if (input.parentId) {
      await this.assertCategoryInOrg(organizationId, input.parentId);
    }

    const category = await this.db.productCategory.create({
      data: { organizationId, name: input.name, parentId: input.parentId ?? null },
    });

    await this.audit.log({
      organizationId,
      userId: actingUserId,
      action: "PRODUCT_CATEGORY_CREATED",
      entityType: "ProductCategory",
      entityId: category.id,
      newValue: { name: category.name, parentId: category.parentId },
    });

    return toSummary(category);
  }

  async update(
    organizationId: string,
    actingUserId: string,
    id: string,
    input: UpdateProductCategoryInput
  ): Promise<ProductCategorySummary> {
    const existing = await this.db.productCategory.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundException("Category not found");

    if (input.parentId) {
      await this.assertNoCycle(organizationId, id, input.parentId);
    }

    const category = await this.db.productCategory.update({
      where: { id },
      data: {
        name: input.name,
        active: input.active,
        parentId: input.parentId === undefined ? undefined : input.parentId,
      },
    });

    await this.audit.log({
      organizationId,
      userId: actingUserId,
      action: "PRODUCT_CATEGORY_UPDATED",
      entityType: "ProductCategory",
      entityId: id,
      oldValue: { name: existing.name, parentId: existing.parentId, active: existing.active },
      newValue: { name: category.name, parentId: category.parentId, active: category.active },
    });

    return toSummary(category);
  }

  /**
   * Cross-tenant FK ownership check: the tenant-safe Prisma extension only
   * auto-scopes the model being queried directly, not IDs referenced from a
   * request body (categoryId/parentId). Without this, an attacker in Org A
   * could attach their Product to a categoryId belonging to Org B (an IDOR
   * class M1.1 specifically probed for — see security-hardening.e2e.spec.ts).
   */
  async assertCategoryInOrg(organizationId: string, categoryId: string): Promise<void> {
    const category = await this.db.productCategory.findFirst({ where: { id: categoryId, organizationId } });
    if (!category) throw new BadRequestException("categoryId does not belong to your organization");
  }

  /** Walks the proposed-parent chain to prevent a cycle (self-parent is depth 0 of this same check). */
  private async assertNoCycle(organizationId: string, categoryId: string, proposedParentId: string): Promise<void> {
    let currentId: string | null = proposedParentId;
    let depth = 0;
    while (currentId && depth < MAX_TREE_DEPTH) {
      if (currentId === categoryId) {
        throw new BadRequestException("This would create a cycle in the category tree");
      }
      const current: { parentId: string | null } | null = await this.db.productCategory.findFirst({
        where: { id: currentId, organizationId },
        select: { parentId: true },
      });
      if (!current) {
        throw new BadRequestException("parentId does not belong to your organization");
      }
      currentId = current.parentId;
      depth++;
    }
  }
}

function toSummary(category: {
  id: string;
  parentId: string | null;
  name: string;
  active: boolean;
  createdAt: Date;
}): ProductCategorySummary {
  return {
    id: category.id,
    parentId: category.parentId,
    name: category.name,
    active: category.active,
    createdAt: category.createdAt.toISOString(),
  };
}
