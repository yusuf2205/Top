import { z } from "zod";
import { positiveDecimalString, decimalString } from "./decimal";

/**
 * Fixed physical-unit set — see M2-PRODUCT-STOCK-ARCHITECTURE.md OD-03:
 * deliberately an enum, not a UnitOfMeasure table. Duplicated here (matching
 * packages/types and the Prisma enum) rather than imported from @top/database
 * — same browser-bundle rationale as products.ts.
 */
export const uomCodeValues = ["PCS", "KG", "G", "TON", "M", "CM", "MM", "M2", "M3", "L", "ML"] as const;
export type UomCode = (typeof uomCodeValues)[number];

/**
 * Physical dimension classification — pure metadata, never persisted on any
 * row (Product/UomConversion only ever store a UomCode). Deliberately not a
 * Prisma model/enum (M2.2 §12): a stored Dimension column would just be a
 * derivable duplicate of this table, risking drift.
 */
export const UOM_DIMENSIONS = {
  PCS: "COUNT",
  KG: "MASS",
  G: "MASS",
  TON: "MASS",
  M: "LENGTH",
  CM: "LENGTH",
  MM: "LENGTH",
  M2: "AREA",
  M3: "VOLUME",
  L: "VOLUME",
  ML: "VOLUME",
} as const satisfies Record<UomCode, string>;
export type UomDimension = (typeof UOM_DIMENSIONS)[UomCode];

/**
 * Exact same-dimension conversion factors, relative to each dimension's
 * canonical base unit (MASS→KG, LENGTH→M, VOLUME→L, COUNT→PCS, AREA→M2).
 * Stored as decimal STRINGS, never JS numbers — the actual arithmetic
 * (Prisma.Decimal multiplication/division) happens backend-only in
 * apps/api, since this package must stay free of @prisma/client for the
 * browser bundle. These are universal SI conversions — no "confirmation"
 * workflow applies to them, unlike cross-dimension product-specific ratios.
 */
export const UOM_BASE_FACTORS = {
  KG: "1",
  G: "0.001",
  TON: "1000",
  M: "1",
  CM: "0.01",
  MM: "0.001",
  M2: "1",
  M3: "1000",
  L: "1",
  ML: "0.001",
  PCS: "1",
} as const satisfies Record<UomCode, string>;

export function getUomDimension(code: UomCode): UomDimension {
  return UOM_DIMENSIONS[code];
}

export function isSameDimension(a: UomCode, b: UomCode): boolean {
  return UOM_DIMENSIONS[a] === UOM_DIMENSIONS[b];
}

export const conversionSourceValues = ["CONFIGURED", "MEASURED", "NOT_AVAILABLE"] as const;

/**
 * ratio is required unless source is NOT_AVAILABLE (which means "this
 * alternative UOM is recognized for the product, but no safe coefficient is
 * known yet" — see M2.2 Phase A §14, this state substitutes for a separate
 * ProductUom table). The reverse (ratio present while source is
 * NOT_AVAILABLE) is rejected too — a single row can't mean both things.
 */
export const createUomConversionSchema = z
  .object({
    uomCode: z.enum(uomCodeValues),
    source: z.enum(conversionSourceValues),
    ratio: positiveDecimalString.optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.source === "NOT_AVAILABLE" && data.ratio !== undefined) {
      ctx.addIssue({ code: "custom", message: "ratio must not be set when source is NOT_AVAILABLE", path: ["ratio"] });
    }
    if (data.source !== "NOT_AVAILABLE" && data.ratio === undefined) {
      ctx.addIssue({ code: "custom", message: "ratio is required when source is CONFIGURED or MEASURED", path: ["ratio"] });
    }
  });
export type CreateUomConversionInput = z.infer<typeof createUomConversionSchema>;

/**
 * Partial update — the resulting merged (source, ratio) state is validated
 * for the same invariant at the service layer (it has the existing row to
 * merge against, which zod alone doesn't see on a PATCH).
 */
export const updateUomConversionSchema = z.object({
  source: z.enum(conversionSourceValues).optional(),
  ratio: positiveDecimalString.optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
export type UpdateUomConversionInput = z.infer<typeof updateUomConversionSchema>;

export const convertQuantitySchema = z.object({
  quantity: decimalString,
  fromUomCode: z.enum(uomCodeValues),
  toUomCode: z.enum(uomCodeValues),
});
export type ConvertQuantityInput = z.infer<typeof convertQuantitySchema>;
