import { z } from "zod";
import { decimalString } from "./decimal";
import { uomCodeValues } from "./uom";

/**
 * M2.4-B — StockBalance is a safe storage model for the current aggregated
 * stock state only; there is no receive/issue/transfer/adjust endpoint yet
 * (that requires StockMovement, a separate not-yet-approved slice). PATCH
 * intentionally does NOT allow changing productId/warehouseId/locationId/
 * uomCode — those define the logical identity of a balance row; changing
 * any of them would silently repoint it onto a different (product,
 * warehouse, location) combination. Only onHandQty/reservedQty are
 * administratively adjustable at this stage.
 */
export const createStockBalanceSchema = z.object({
  productId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  locationId: z.string().uuid().optional(),
  uomCode: z.enum(uomCodeValues),
  onHandQty: decimalString.optional(),
  reservedQty: decimalString.optional(),
});
export type CreateStockBalanceInput = z.infer<typeof createStockBalanceSchema>;

export const updateStockBalanceSchema = z.object({
  onHandQty: decimalString.optional(),
  reservedQty: decimalString.optional(),
});
export type UpdateStockBalanceInput = z.infer<typeof updateStockBalanceSchema>;

export const listStockBalancesQuerySchema = z.object({
  productId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
});
export type ListStockBalancesQuery = z.infer<typeof listStockBalancesQuerySchema>;
