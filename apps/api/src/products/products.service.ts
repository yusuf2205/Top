import { randomBytes } from "node:crypto";
import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@top/database";
import type { createTenantSafePrismaClient } from "@top/database";
import type { CreateProductInput, ListProductsQuery, UpdateProductInput } from "@top/validation";
import type { ProductListResult, ProductSummary } from "@top/types";
import { TENANT_PRISMA } from "../database/database.module";
import { AuditService } from "../common/audit/audit.service";
import { ProductCategoriesService } from "./product-categories.service";

type TenantDb = ReturnType<typeof createTenantSafePrismaClient>;
type ProductRow = Awaited<ReturnType<TenantDb["product"]["create"]>>;

const SKU_GENERATION_ATTEMPTS = 5;

@Injectable()
export class ProductsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly categories: ProductCategoriesService
  ) {}

  async list(organizationId: string, query: ListProductsQuery): Promise<ProductListResult> {
    const where: Prisma.ProductWhereInput = {
      organizationId,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.productType ? { productType: query.productType } : {}),
      ...(query.active !== undefined ? { active: query.active } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: Prisma.QueryMode.insensitive } },
              { sku: { contains: query.search, mode: Prisma.QueryMode.insensitive } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.db.product.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.product.count({ where }),
    ]);

    return { items: items.map(toSummary), total, page: query.page, pageSize: query.pageSize };
  }

  async get(organizationId: string, id: string): Promise<ProductSummary> {
    const product = await this.db.product.findFirst({ where: { id, organizationId } });
    if (!product) throw new NotFoundException("Product not found");
    return toSummary(product);
  }

  async create(organizationId: string, actingUserId: string, input: CreateProductInput): Promise<ProductSummary> {
    if (input.categoryId) {
      await this.categories.assertCategoryInOrg(organizationId, input.categoryId);
    }

    // SERVICE products never enter stock — enforced here, not left to client input
    // (§8 of the M2 prompt: "Service не должен попадать в stock").
    const stockTracked = input.productType !== "SERVICE";

    const baseData = {
      organizationId,
      name: input.name,
      description: input.description ?? null,
      productType: input.productType,
      categoryId: input.categoryId ?? null,
      brand: input.brand ?? null,
      manufacturer: input.manufacturer ?? null,
      baseUomCode: input.baseUomCode,
      trackingMode: input.trackingMode ?? "QUANTITY",
      stockTracked,
      weightNetKg: input.weightNetKg ?? null,
      weightGrossKg: input.weightGrossKg ?? null,
      barcode: input.barcode ?? null,
      createdById: actingUserId,
    } satisfies Omit<Prisma.ProductUncheckedCreateInput, "sku">;

    const product = input.sku
      ? await this.createWithSku(baseData, normalizeSku(input.sku), /* allowRetry */ false)
      : await this.createWithGeneratedSku(baseData);

    await this.audit.log({
      organizationId,
      userId: actingUserId,
      action: "PRODUCT_CREATED",
      entityType: "Product",
      entityId: product.id,
      newValue: { sku: product.sku, name: product.name, productType: product.productType },
    });

    return toSummary(product);
  }

  async update(
    organizationId: string,
    actingUserId: string,
    id: string,
    input: UpdateProductInput
  ): Promise<ProductSummary> {
    const existing = await this.db.product.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundException("Product not found");

    if (input.categoryId) {
      await this.categories.assertCategoryInOrg(organizationId, input.categoryId);
    }

    const nextProductType = input.productType ?? existing.productType;
    const stockTracked = nextProductType === "SERVICE" ? false : existing.stockTracked;

    let product: ProductRow;
    try {
      product = await this.db.product.update({
        where: { id },
        data: {
          sku: input.sku ? normalizeSku(input.sku) : undefined,
          name: input.name,
          description: input.description,
          productType: input.productType,
          categoryId: input.categoryId,
          brand: input.brand,
          manufacturer: input.manufacturer,
          baseUomCode: input.baseUomCode,
          trackingMode: input.trackingMode,
          weightNetKg: input.weightNetKg,
          weightGrossKg: input.weightGrossKg,
          barcode: input.barcode,
          stockTracked,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException("A product with this SKU already exists in your organization");
      }
      throw err;
    }

    await this.audit.log({
      organizationId,
      userId: actingUserId,
      action: "PRODUCT_UPDATED",
      entityType: "Product",
      entityId: id,
      oldValue: { sku: existing.sku, name: existing.name, active: existing.active },
      newValue: { sku: product.sku, name: product.name, active: product.active },
    });

    return toSummary(product);
  }

  async archive(organizationId: string, actingUserId: string, id: string): Promise<ProductSummary> {
    const existing = await this.db.product.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundException("Product not found");

    const product = await this.db.product.update({ where: { id }, data: { active: false } });

    await this.audit.log({
      organizationId,
      userId: actingUserId,
      action: "PRODUCT_ARCHIVED",
      entityType: "Product",
      entityId: id,
    });

    return toSummary(product);
  }

  private async createWithSku(
    baseData: Omit<Prisma.ProductUncheckedCreateInput, "sku">,
    sku: string,
    allowRetry: boolean
  ): Promise<ProductRow> {
    try {
      return await this.db.product.create({ data: { ...baseData, sku } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        if (allowRetry) throw err; // caller (generated-SKU path) handles the retry loop
        throw new ConflictException("A product with this SKU already exists in your organization");
      }
      throw err;
    }
  }

  private async createWithGeneratedSku(
    baseData: Omit<Prisma.ProductUncheckedCreateInput, "sku">
  ): Promise<ProductRow> {
    // No SKU supplied: auto-generate, retrying on the rare random collision —
    // the org-unique DB constraint is the real backstop, this loop is a UX nicety.
    for (let attempt = 0; attempt < SKU_GENERATION_ATTEMPTS; attempt++) {
      try {
        return await this.createWithSku(baseData, generateSku(), true);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
        throw err;
      }
    }
    throw new ConflictException("Could not generate a unique SKU, please supply one explicitly");
  }
}

function normalizeSku(sku: string): string {
  return sku.trim().toUpperCase();
}

function generateSku(): string {
  return `PRD-${randomBytes(5).toString("hex").toUpperCase()}`;
}

function toSummary(product: ProductRow): ProductSummary {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    description: product.description,
    productType: product.productType as ProductSummary["productType"],
    categoryId: product.categoryId,
    brand: product.brand,
    manufacturer: product.manufacturer,
    active: product.active,
    baseUomCode: product.baseUomCode as ProductSummary["baseUomCode"],
    trackingMode: product.trackingMode as ProductSummary["trackingMode"],
    stockTracked: product.stockTracked,
    weightNetKg: product.weightNetKg?.toString() ?? null,
    weightGrossKg: product.weightGrossKg?.toString() ?? null,
    barcode: product.barcode,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}
