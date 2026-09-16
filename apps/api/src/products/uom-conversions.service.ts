import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@top/database";
import type { createTenantSafePrismaClient } from "@top/database";
import { UOM_BASE_FACTORS, isSameDimension } from "@top/validation";
import type { ConvertQuantityInput, CreateUomConversionInput, UomCode, UpdateUomConversionInput } from "@top/validation";
import type { ConvertQuantityResult, UomConversionSummary } from "@top/types";
import { TENANT_PRISMA, type TenantTransactionClient } from "../database/database.module";
import { AuditService } from "../common/audit/audit.service";

type TenantDb = ReturnType<typeof createTenantSafePrismaClient>;
type UomConversionRow = Awaited<ReturnType<TenantDb["uomConversion"]["create"]>>;

// Final display/storage precision for a converted quantity — matches the
// project's Decimal(18,3) quantity convention (see M2.2 §10: high precision
// during intermediate math, rounded only at the point of a final result).
const QUANTITY_DISPLAY_DECIMALS = 3;
const ROUND_HALF_UP = Prisma.Decimal.ROUND_HALF_UP;

@Injectable()
export class UomConversionsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantDb,
    private readonly audit: AuditService
  ) {}

  async list(organizationId: string, productId: string): Promise<UomConversionSummary[]> {
    await this.requireProduct(organizationId, productId);
    const rows = await this.db.uomConversion.findMany({
      where: { productId, organizationId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toSummary);
  }

  async create(
    organizationId: string,
    actingUserId: string,
    productId: string,
    input: CreateUomConversionInput
  ): Promise<UomConversionSummary> {
    const product = await this.requireProduct(organizationId, productId);
    const baseUom = product.baseUomCode as UomCode;

    if (input.uomCode === baseUom) {
      throw new BadRequestException("uomCode must differ from the product's base UOM");
    }
    if (isSameDimension(input.uomCode, baseUom)) {
      throw new BadRequestException(
        `${input.uomCode} is the same physical dimension as the base UOM (${baseUom}) — ` +
          "same-dimension conversion is automatic and must not be overridden"
      );
    }

    const confirmed = input.source !== "NOT_AVAILABLE";
    let conversion: UomConversionRow;
    try {
      conversion = await this.db.uomConversion.create({
        data: {
          organizationId,
          productId,
          uomCode: input.uomCode,
          ratio: confirmed ? input.ratio : null,
          source: input.source,
          notes: input.notes ?? null,
          confirmedById: confirmed ? actingUserId : null,
          confirmedAt: confirmed ? new Date() : null,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException("A conversion for this UOM already exists for this product");
      }
      throw err;
    }

    await this.audit.log({
      organizationId,
      userId: actingUserId,
      action: "UOM_CONVERSION_CREATED",
      entityType: "UomConversion",
      entityId: conversion.id,
      newValue: { uomCode: conversion.uomCode, ratio: conversion.ratio?.toString() ?? null, source: conversion.source },
    });

    return toSummary(conversion);
  }

  async update(
    organizationId: string,
    actingUserId: string,
    productId: string,
    conversionId: string,
    input: UpdateUomConversionInput
  ): Promise<UomConversionSummary> {
    await this.requireProduct(organizationId, productId);
    const existing = await this.db.uomConversion.findFirst({ where: { id: conversionId, productId, organizationId } });
    if (!existing) throw new NotFoundException("Conversion not found");

    const nextSource = input.source ?? existing.source;
    let nextRatio: string | null;
    if (nextSource === "NOT_AVAILABLE") {
      nextRatio = null;
    } else if (input.ratio !== undefined) {
      nextRatio = input.ratio;
    } else if (existing.ratio !== null) {
      nextRatio = existing.ratio.toString();
    } else {
      throw new BadRequestException("ratio is required when source is CONFIGURED or MEASURED");
    }
    const confirmed = nextSource !== "NOT_AVAILABLE";

    const conversion = await this.db.uomConversion.update({
      where: { id: conversionId },
      data: {
        source: nextSource,
        ratio: nextRatio,
        notes: input.notes !== undefined ? input.notes : undefined,
        confirmedById: confirmed ? actingUserId : null,
        confirmedAt: confirmed ? new Date() : null,
      },
    });

    await this.audit.log({
      organizationId,
      userId: actingUserId,
      action: "UOM_CONVERSION_UPDATED",
      entityType: "UomConversion",
      entityId: conversionId,
      oldValue: { ratio: existing.ratio?.toString() ?? null, source: existing.source },
      newValue: { ratio: conversion.ratio?.toString() ?? null, source: conversion.source },
    });

    return toSummary(conversion);
  }

  async remove(organizationId: string, actingUserId: string, productId: string, conversionId: string): Promise<void> {
    await this.requireProduct(organizationId, productId);
    const existing = await this.db.uomConversion.findFirst({ where: { id: conversionId, productId, organizationId } });
    if (!existing) throw new NotFoundException("Conversion not found");

    await this.db.uomConversion.delete({ where: { id: conversionId } });

    await this.audit.log({
      organizationId,
      userId: actingUserId,
      action: "UOM_CONVERSION_DELETED",
      entityType: "UomConversion",
      entityId: conversionId,
      oldValue: { uomCode: existing.uomCode, ratio: existing.ratio?.toString() ?? null, source: existing.source },
    });
  }

  /**
   * Never guesses. Same-dimension pairs (kg<->g, m<->cm) use exact SI math.
   * Cross-dimension pairs go through this product's confirmed conversions
   * only — anchored at the product's base UOM, chaining through it for a
   * non-base<->non-base pair (e.g. m<->pcs when base=kg). Throws
   * ConflictException if a required leg is missing or NOT_AVAILABLE — never
   * falls back to a density/geometry formula (M2.2 §18).
   *
   * M2.5 (Phase F): optional `tx` parameter. When supplied (only
   * StockMovementsService does), every read below runs via that transaction
   * client instead of the injected TENANT_PRISMA instance, so conversion
   * lookups participate in the same transaction as the movement they're
   * computing a baseQuantity for. Every existing call site (the standalone
   * POST /api/v1/products/:id/convert endpoint) is unaffected — the
   * parameter is optional and defaults to the exact prior behavior.
   */
  async convert(
    organizationId: string,
    productId: string,
    input: ConvertQuantityInput,
    tx?: TenantTransactionClient
  ): Promise<ConvertQuantityResult> {
    // Two explicit branches rather than `const client = tx ?? this.db`:
    // unifying TenantTransactionClient | TenantDb into one call target sends
    // TypeScript into an "excessive stack depth" comparison between their
    // two very different generic client shapes (confirmed empirically in
    // Phase F, same failure mode as AuditService.log). Branching keeps each
    // lookup independently, simply typed.
    const product = tx
      ? await this.requireProductTx(tx, organizationId, productId)
      : await this.requireProduct(organizationId, productId);
    const quantity = new Prisma.Decimal(input.quantity);
    const { fromUomCode: from, toUomCode: to } = input;

    if (from === to) {
      return { quantity: round(quantity), uomCode: to };
    }

    if (isSameDimension(from, to)) {
      return { quantity: round(convertSameDimension(quantity, from, to)), uomCode: to };
    }

    const baseUom = product.baseUomCode as UomCode;
    let result: Prisma.Decimal;

    if (from === baseUom) {
      const ratio = await this.requireConfirmedRatio(organizationId, productId, to, tx);
      result = quantity.mul(ratio);
    } else if (to === baseUom) {
      const ratio = await this.requireConfirmedRatio(organizationId, productId, from, tx);
      result = quantity.div(ratio);
    } else {
      const fromRatio = await this.requireConfirmedRatio(organizationId, productId, from, tx);
      const toRatio = await this.requireConfirmedRatio(organizationId, productId, to, tx);
      result = quantity.div(fromRatio).mul(toRatio);
    }

    return { quantity: round(result), uomCode: to };
  }

  private async requireConfirmedRatio(
    organizationId: string,
    productId: string,
    uomCode: UomCode,
    tx?: TenantTransactionClient
  ): Promise<Prisma.Decimal> {
    const row = tx
      ? await tx.uomConversion.findFirst({ where: { productId, organizationId, uomCode } })
      : await this.db.uomConversion.findFirst({ where: { productId, organizationId, uomCode } });
    if (!row || row.source === "NOT_AVAILABLE" || row.ratio === null) {
      throw new ConflictException(`No confirmed conversion available for ${uomCode} on this product`);
    }
    return row.ratio;
  }

  private async requireProduct(organizationId: string, productId: string) {
    const product = await this.db.product.findFirst({ where: { id: productId, organizationId } });
    if (!product) throw new NotFoundException("Product not found");
    return product;
  }

  private async requireProductTx(tx: TenantTransactionClient, organizationId: string, productId: string) {
    const product = await tx.product.findFirst({ where: { id: productId, organizationId } });
    if (!product) throw new NotFoundException("Product not found");
    return product;
  }
}

function convertSameDimension(quantity: Prisma.Decimal, from: UomCode, to: UomCode): Prisma.Decimal {
  const fromFactor = new Prisma.Decimal(UOM_BASE_FACTORS[from]);
  const toFactor = new Prisma.Decimal(UOM_BASE_FACTORS[to]);
  return quantity.mul(fromFactor).div(toFactor);
}

// toFixed (not toDecimalPlaces().toString()) guarantees a fixed-notation
// string with exactly QUANTITY_DISPLAY_DECIMALS digits, matching how a
// stored Decimal(18,3) column round-trips through Prisma (e.g. "5.000", not "5").
function round(value: Prisma.Decimal): string {
  return value.toFixed(QUANTITY_DISPLAY_DECIMALS, ROUND_HALF_UP);
}

function toSummary(row: UomConversionRow): UomConversionSummary {
  return {
    id: row.id,
    uomCode: row.uomCode as UomConversionSummary["uomCode"],
    ratio: row.ratio?.toString() ?? null,
    source: row.source as UomConversionSummary["source"],
    notes: row.notes,
    confirmedById: row.confirmedById,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
