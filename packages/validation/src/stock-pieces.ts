import { z } from "zod";
import { decimalString } from "./decimal";
import { uomCodeValues } from "./uom";

/**
 * M2.4-D (final, approved with changes) — CRUD/read only, no PATCH, no
 * DELETE. `parentPieceId` is deliberately absent from this schema: it must
 * only ever be written by a future atomic split/issue operation, never by
 * a standalone create — see stock-pieces.service.ts's doc comment.
 * `productId` is likewise absent — always server-derived from the parent
 * StockLot, same pattern as StockLotPlacement.
 */
export const createStockPieceSchema = z.object({
  lotId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  locationId: z.string().uuid().optional(),
  uomCode: z.enum(uomCodeValues),
  quantity: decimalString.refine((v) => Number(v) > 0, "Must be greater than zero"),
});
export type CreateStockPieceInput = z.infer<typeof createStockPieceSchema>;

export const listStockPiecesQuerySchema = z.object({
  lotId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  status: z.enum(["AVAILABLE", "RESERVED", "CONSUMED", "SCRAPPED"]).optional(),
});
export type ListStockPiecesQuery = z.infer<typeof listStockPiecesQuerySchema>;
