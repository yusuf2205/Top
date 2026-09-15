import { z } from "zod";
import { decimalString } from "./decimal";
import { uomCodeValues } from "./uom";

/**
 * M2.4-C — two-level lot model (architecture gate, approved).
 *
 * StockLot: physical batch identity only. `lotNumber` is external provenance
 * (supplier/manufacturer lot numbers are not globally unique and TOP doesn't
 * control them) — deliberately NOT unique anywhere, and nullable.
 * `supplierId` is provenance metadata only, never part of identity.
 */
export const createStockLotSchema = z.object({
  productId: z.string().uuid(),
  supplierId: z.string().uuid().optional(),
  lotNumber: z.string().trim().min(1).max(200).optional(),
  receivedAt: z.string().datetime().optional(),
});
export type CreateStockLotInput = z.infer<typeof createStockLotSchema>;

export const updateStockLotSchema = z.object({
  supplierId: z.string().uuid().nullable().optional(),
  lotNumber: z.string().trim().min(1).max(200).nullable().optional(),
  receivedAt: z.string().datetime().optional(),
});
export type UpdateStockLotInput = z.infer<typeof updateStockLotSchema>;

export const listStockLotsQuerySchema = z.object({
  productId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  lotNumber: z.string().trim().min(1).max(200).optional(),
});
export type ListStockLotsQuery = z.infer<typeof listStockLotsQuerySchema>;

/**
 * StockLotPlacement: physical placement of part of a lot at a
 * warehouse/location. `productId` is deliberately NOT a field here — it is
 * always server-derived from the parent StockLot (see
 * stock-lot-placements.service.ts), so a client-supplied value has nothing
 * to bind to and is silently stripped by zod's default parsing. PATCH only
 * allows `quantity` — warehouseId/locationId/uomCode define the row's
 * logical identity and are not repointable (same rule as StockBalance in
 * M2.4-B).
 */
export const createStockLotPlacementSchema = z.object({
  warehouseId: z.string().uuid(),
  locationId: z.string().uuid().optional(),
  uomCode: z.enum(uomCodeValues),
  quantity: decimalString.optional(),
});
export type CreateStockLotPlacementInput = z.infer<typeof createStockLotPlacementSchema>;

export const updateStockLotPlacementSchema = z.object({
  quantity: decimalString.optional(),
});
export type UpdateStockLotPlacementInput = z.infer<typeof updateStockLotPlacementSchema>;

export const listStockLotPlacementsQuerySchema = z.object({
  warehouseId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
});
export type ListStockLotPlacementsQuery = z.infer<typeof listStockLotPlacementsQuerySchema>;
