import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@top/database";
import type { createTenantSafePrismaClient } from "@top/database";
import type { SetMaterialSpecificationInput } from "@top/validation";
import type { MaterialSpecificationSummary } from "@top/types";
import { TENANT_PRISMA } from "../database/database.module";
import { AuditService } from "../common/audit/audit.service";

type TenantDb = ReturnType<typeof createTenantSafePrismaClient>;
type SpecRow = Awaited<ReturnType<TenantDb["materialSpecification"]["upsert"]>>;

/**
 * MaterialSpecification has no organizationId of its own (M2.3 design: child
 * of Product, same pattern as PurchaseRequestItem/AIExtraction) — every
 * method below MUST resolve/verify the owning Product through the
 * tenant-safe client first. There is no direct-by-id route for this
 * resource at all (always /products/:productId/specification), so this
 * requireProduct() call is the entire tenant-isolation boundary.
 */
@Injectable()
export class MaterialSpecificationsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantDb,
    private readonly audit: AuditService
  ) {}

  async get(organizationId: string, productId: string): Promise<MaterialSpecificationSummary | null> {
    await this.requireProduct(organizationId, productId);
    const row = await this.db.materialSpecification.findUnique({ where: { productId } });
    return row ? toSummary(row) : null;
  }

  /**
   * Full replace (PUT/upsert semantics), not a PATCH-style merge: every
   * field is written explicitly (input value or null), so a field omitted
   * from the request body is cleared, not left untouched.
   */
  async set(
    organizationId: string,
    actingUserId: string,
    productId: string,
    input: SetMaterialSpecificationInput
  ): Promise<MaterialSpecificationSummary> {
    await this.requireProduct(organizationId, productId);
    const existing = await this.db.materialSpecification.findUnique({ where: { productId } });

    const fields = {
      material: input.material ?? null,
      grade: input.grade ?? null,
      standard: input.standard ?? null,
      countryOfOrigin: input.countryOfOrigin ?? null,
      widthMm: input.widthMm ?? null,
      thicknessMm: input.thicknessMm ?? null,
      lengthMm: input.lengthMm ?? null,
      heightMm: input.heightMm ?? null,
      outerDiameterMm: input.outerDiameterMm ?? null,
      innerDiameterMm: input.innerDiameterMm ?? null,
      crossSectionMm2: input.crossSectionMm2 ?? null,
      densityKgM3: input.densityKgM3 ?? null,
      attributes: (input.attributes as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
    };
    const displayValue = buildDisplayValue(input);

    const row = await this.db.materialSpecification.upsert({
      where: { productId },
      create: { productId, ...fields, displayValue },
      update: { ...fields, displayValue },
    });

    await this.audit.log({
      organizationId,
      userId: actingUserId,
      action: "MATERIAL_SPECIFICATION_SET",
      entityType: "MaterialSpecification",
      entityId: row.id,
      oldValue: existing ? toAuditSnapshot(existing) : null,
      newValue: toAuditSnapshot(row),
    });

    return toSummary(row);
  }

  async remove(organizationId: string, actingUserId: string, productId: string): Promise<void> {
    await this.requireProduct(organizationId, productId);
    const existing = await this.db.materialSpecification.findUnique({ where: { productId } });
    if (!existing) throw new NotFoundException("Specification not found");

    await this.db.materialSpecification.delete({ where: { productId } });

    await this.audit.log({
      organizationId,
      userId: actingUserId,
      action: "MATERIAL_SPECIFICATION_DELETED",
      entityType: "MaterialSpecification",
      entityId: existing.id,
      oldValue: toAuditSnapshot(existing),
    });
  }

  private async requireProduct(organizationId: string, productId: string): Promise<void> {
    const product = await this.db.product.findFirst({ where: { id: productId, organizationId } });
    if (!product) throw new NotFoundException("Product not found");
  }
}

function toAuditSnapshot(row: SpecRow): Record<string, unknown> {
  return {
    material: row.material,
    grade: row.grade,
    widthMm: row.widthMm?.toString() ?? null,
    thicknessMm: row.thicknessMm?.toString() ?? null,
    lengthMm: row.lengthMm?.toString() ?? null,
  };
}

function toSummary(row: SpecRow): MaterialSpecificationSummary {
  return {
    productId: row.productId,
    material: row.material,
    grade: row.grade,
    standard: row.standard,
    countryOfOrigin: row.countryOfOrigin,
    widthMm: row.widthMm?.toString() ?? null,
    thicknessMm: row.thicknessMm?.toString() ?? null,
    lengthMm: row.lengthMm?.toString() ?? null,
    heightMm: row.heightMm?.toString() ?? null,
    outerDiameterMm: row.outerDiameterMm?.toString() ?? null,
    innerDiameterMm: row.innerDiameterMm?.toString() ?? null,
    crossSectionMm2: row.crossSectionMm2?.toString() ?? null,
    densityKgM3: row.densityKgM3?.toString() ?? null,
    attributes: (row.attributes as MaterialSpecificationSummary["attributes"]) ?? null,
    displayValue: row.displayValue,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Denormalized human-readable summary, recomputed on every write — never
 * the only representation of the data (structured fields are the source of
 * truth), just a display convenience (M2-PRODUCT-STOCK-ARCHITECTURE.md
 * §14/§21).
 */
function buildDisplayValue(input: SetMaterialSpecificationInput): string | null {
  const segments: string[] = [];

  if (input.material) {
    segments.push(input.grade ? `${input.material} ${input.grade}` : input.material);
  }

  const dims: string[] = [];
  if (input.widthMm) dims.push(`W${input.widthMm}`);
  if (input.thicknessMm) dims.push(`T${input.thicknessMm}`);
  if (input.heightMm) dims.push(`H${input.heightMm}`);
  if (input.outerDiameterMm) dims.push(`⌀${input.outerDiameterMm}`);
  if (input.lengthMm) dims.push(`L${input.lengthMm}`);
  if (dims.length > 0) segments.push(`${dims.join("×")} mm`);

  if (input.crossSectionMm2) segments.push(`${input.crossSectionMm2} mm²`);

  return segments.length > 0 ? segments.join(" · ") : null;
}
