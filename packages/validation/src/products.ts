import { z } from "zod";
import { decimalString } from "./decimal";
import { uomCodeValues } from "./uom";

/**
 * ProductType/ProductTrackingMode are duplicated here as zod enums (matching
 * packages/types and the Prisma enums) rather than imported from
 * @top/database — same browser-bundle rationale as auth.ts/organizations.ts.
 * uomCodeValues/decimalString are shared with uom.ts/decimal.ts to avoid drift.
 */
const productTypeValues = ["GOODS", "MATERIAL", "RAW_MATERIAL", "COMPONENT", "CONSUMABLE", "SERVICE"] as const;
const productTrackingModeValues = ["QUANTITY", "LOT", "PIECE"] as const;

export const createProductCategorySchema = z.object({
  name: z.string().trim().min(1).max(200),
  parentId: z.string().uuid().optional(),
});
export type CreateProductCategoryInput = z.infer<typeof createProductCategorySchema>;

export const updateProductCategorySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  parentId: z.string().uuid().nullable().optional(),
  active: z.boolean().optional(),
});
export type UpdateProductCategoryInput = z.infer<typeof updateProductCategorySchema>;

export const createProductSchema = z.object({
  sku: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(300),
  description: z.string().trim().max(2000).optional(),
  productType: z.enum(productTypeValues),
  categoryId: z.string().uuid().optional(),
  brand: z.string().trim().max(200).optional(),
  manufacturer: z.string().trim().max(200).optional(),
  baseUomCode: z.enum(uomCodeValues),
  trackingMode: z.enum(productTrackingModeValues).optional(),
  weightNetKg: decimalString.optional(),
  weightGrossKg: decimalString.optional(),
  barcode: z.string().trim().max(100).optional(),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = z.object({
  sku: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  productType: z.enum(productTypeValues).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  brand: z.string().trim().max(200).nullable().optional(),
  manufacturer: z.string().trim().max(200).nullable().optional(),
  baseUomCode: z.enum(uomCodeValues).optional(),
  trackingMode: z.enum(productTrackingModeValues).optional(),
  weightNetKg: decimalString.nullable().optional(),
  weightGrossKg: decimalString.nullable().optional(),
  barcode: z.string().trim().max(100).nullable().optional(),
});
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const listProductsQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  categoryId: z.string().uuid().optional(),
  productType: z.enum(productTypeValues).optional(),
  // Not z.coerce.boolean(): JS `Boolean("false")` is `true` (any non-empty
  // string is truthy), which would silently break `?active=false`.
  active: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
