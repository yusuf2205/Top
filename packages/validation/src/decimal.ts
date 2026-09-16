import { z } from "zod";

/**
 * Decimal-safe numeric input: accepted as a string, never `z.number()`.
 * JS `number` is a float internally — for quantities/weights/factors that
 * require exact Decimal precision downstream, the API boundary never
 * round-trips through float at all; the service layer parses this string
 * directly into a Prisma Decimal.
 */

/** Non-negative, up to 3 decimal places — matches the project's Decimal(18,3) quantity/weight convention. */
export const decimalString = z
  .string()
  .trim()
  .regex(/^\d{1,15}(\.\d{1,3})?$/, "Must be a non-negative decimal with at most 3 decimal places");

/**
 * Strictly positive, up to 6 decimal places — matches Decimal(18,6), the
 * project's ratio/rate convention (see ExchangeRate.rate). Used for UOM
 * conversion factors, which must never be zero (division by zero on the
 * inverse direction) or negative (physically meaningless).
 */
export const positiveDecimalString = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,6})?$/, "Must be a positive decimal with at most 6 decimal places")
  .refine((v) => Number(v) > 0, "Must be greater than zero");

/**
 * Non-negative, up to 2 decimal places — matches the project's Decimal(18,2)
 * money/amount convention (see PurchaseRequest.estimatedBudget, and
 * Quote.deliveryCost/PurchaseOrder.totalAmount later). Kept here rather than
 * as a one-off local regex, same reasoning as decimalString/positiveDecimalString:
 * one canonical validator per DB precision-scale convention.
 */
export const moneyString = z
  .string()
  .trim()
  .regex(/^\d{1,16}(\.\d{1,2})?$/, "Must be a non-negative amount with at most 2 decimal places");
