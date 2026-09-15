import { z } from "zod";

/**
 * M2.4-A — Warehouse + Location only (StockBalance/StockLot/StockPiece/
 * StockMovement are a separate, not-yet-approved slice). Location is a flat
 * list under Warehouse, not a tree — see schema.prisma's Location doc comment.
 */
export const createWarehouseSchema = z.object({
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(300),
  description: z.string().trim().max(2000).optional(),
});
export type CreateWarehouseInput = z.infer<typeof createWarehouseSchema>;

export const updateWarehouseSchema = z.object({
  code: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  active: z.boolean().optional(),
});
export type UpdateWarehouseInput = z.infer<typeof updateWarehouseSchema>;

export const createLocationSchema = z.object({
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(300),
});
export type CreateLocationInput = z.infer<typeof createLocationSchema>;

export const updateLocationSchema = z.object({
  code: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(300).optional(),
  active: z.boolean().optional(),
});
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
