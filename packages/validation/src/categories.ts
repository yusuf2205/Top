import { z } from "zod";

/**
 * M3.2 (Architecture Gate Revision 1, R16/R20). Minimal Category CRUD —
 * the pre-existing `Category` model (shared by PurchaseRequest.categoryId
 * and SupplierCategory) had zero CRUD API before this; this closes exactly
 * that gap, nothing more. Reuses the model's existing `active` boolean as
 * its only lifecycle mechanism — no new archive/status concept invented.
 */

const categoryNameSchema = z.string().trim().min(1).max(200);

export const createCategorySchema = z.object({ name: categoryNameSchema }).strict();
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = z
  .object({
    name: categoryNameSchema.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, "At least one field must be provided");
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
