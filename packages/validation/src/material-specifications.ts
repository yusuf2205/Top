import { z } from "zod";
import { decimalString } from "./decimal";
import { uomCodeValues } from "./uom";

/**
 * M2.3 Material Specification — hybrid typed + JSONB model
 * (M2-PRODUCT-STOCK-ARCHITECTURE.md §6, refined at implementation time).
 *
 * Dimension fields are fixed-unit-by-name (widthMm, crossSectionMm2, ...),
 * NOT a {value, uomCode} pair like UomConversion.ratio — the UomCode enum
 * has no square-mm/cm AREA member, so accepting a client-supplied UOM for
 * crossSectionMm2 would force either extending UomCode (an explicit M2.3
 * stop condition: "изменение M2.2 UOM architecture") or adding a parallel
 * xxxUom column per dimension (explicitly forbidden — "не создавать сотни
 * колонок"). Same convention Product.weightNetKg/weightGrossKg already use.
 * All at Decimal(18,3) — reuses the project's existing quantity/weight
 * precision tier rather than inventing a new one.
 */

/**
 * Dynamic attribute bag for anything not common enough to be a typed column
 * (voltage, coreCount, insulation, thread, ...). Deliberately NOT a full
 * EAV/AttributeDefinition engine (§20/§43) — just a zod-validated flat map:
 *   - string / integer / boolean for simple values (unit, if any, encoded in
 *     the key name for units the UomCode enum doesn't cover, e.g. "voltageV")
 *   - {value, uomCode} only for values genuinely compatible with the
 *     existing UomCode vocabulary (e.g. an insulation thickness in mm) —
 *     value is a decimal STRING, never a raw JSON number, to preserve exact
 *     precision (same Decimal-safety discipline as the rest of the API).
 */
const attributeKeySchema = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9]{0,59}$/, "Attribute keys must be alphanumeric, starting with a letter, max 60 chars");

const attributeValueSchema = z.union([
  z.string().trim().min(1).max(500),
  z.number().int(),
  z.boolean(),
  z.object({ value: decimalString, uomCode: z.enum(uomCodeValues) }).strict(),
]);

export const materialAttributesSchema = z
  .record(attributeKeySchema, attributeValueSchema)
  .refine((obj) => Object.keys(obj).length <= 50, "At most 50 attributes are allowed");
export type MaterialAttributes = z.infer<typeof materialAttributesSchema>;

/**
 * Full-replace (PUT/upsert) input: every field is optional, and a field
 * absent from the request is stored as NULL — this is replace semantics,
 * not a PATCH-style merge (the service layer must coalesce every field
 * explicitly, never rely on Prisma's "undefined = leave unchanged").
 * displayValue is intentionally absent — it's server-computed, never
 * client-writable (M2-PRODUCT-STOCK-ARCHITECTURE.md §14/§21).
 */
export const setMaterialSpecificationSchema = z.object({
  material: z.string().trim().min(1).max(200).optional(),
  grade: z.string().trim().min(1).max(100).optional(),
  standard: z.string().trim().min(1).max(300).optional(),
  countryOfOrigin: z.string().trim().min(1).max(100).optional(),
  widthMm: decimalString.optional(),
  thicknessMm: decimalString.optional(),
  lengthMm: decimalString.optional(),
  heightMm: decimalString.optional(),
  outerDiameterMm: decimalString.optional(),
  innerDiameterMm: decimalString.optional(),
  crossSectionMm2: decimalString.optional(),
  densityKgM3: decimalString.optional(),
  attributes: materialAttributesSchema.optional(),
});
export type SetMaterialSpecificationInput = z.infer<typeof setMaterialSpecificationSchema>;
