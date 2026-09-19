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

/**
 * Strictly positive, up to 4 decimal places — matches Decimal(18,4)
 * (QuoteItem.unitPrice, M3.4 Phase B). Strictly positive rather than
 * non-negative: Architecture Revision 1 §12 explicitly left "free items"
 * unrequired by any repository precedent, so the smallest defensible rule is
 * chosen — a zero-price line is rejected, not silently accepted. No existing
 * (18,4) convention existed before this field, so this is a new canonical
 * validator, same one-per-precision-scale discipline as the others in this file.
 */
export const unitPriceString = z
  .string()
  .trim()
  .regex(/^\d{1,14}(\.\d{1,4})?$/, "Must be a positive amount with at most 4 decimal places")
  .refine((v) => Number(v) > 0, "Must be greater than zero");

/**
 * Non-negative, up to 2 decimal places, bounded to [0, 100] — matches
 * Decimal(5,2) (Quote.vatRate, M3.4 Phase B). A percentage, not a money
 * amount, so `moneyString`'s much looser integer-digit allowance (16 digits)
 * is not reused here — this is deliberately its own canonical validator
 * bounded to what a VAT percentage can actually mean.
 */
export const percentString = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, "Must be a non-negative percentage with at most 2 decimal places")
  .refine((v) => Number(v) <= 100, "Must not exceed 100");

/**
 * Pure textual "is this decimal string semantically zero" check — no
 * `Number(...)`/`parseFloat(...)`/unary `+`/`Math.*` (M3.4 Phase B final fix
 * §2-3). Never used to validate format/precision/sign on its own — the
 * caller must already have validated `value` against the appropriate
 * canonical validator above (e.g. `moneyString`) first; this only asks
 * "given an already-valid decimal string, does it mean zero." Splits on the
 * decimal point and checks that every digit on both sides is literally '0'
 * — the only way a string of decimal digits can mean zero. Does not
 * re-validate shape, so an already-invalid string (letters, multiple dots,
 * etc.) is not this function's concern; it would simply return `false`.
 */
export function isZeroDecimalString(value: string): boolean {
  const trimmed = value.trim();
  const [intPart, fracPart] = trimmed.split(".");
  return /^0+$/.test(intPart ?? "") && (fracPart === undefined || /^0+$/.test(fracPart));
}
