import { z } from "zod";
import { isZeroDecimalString, percentString, unitPriceString, moneyString } from "./decimal";

/**
 * M3.4 Supplier Portal Phase B (Architecture Gate + Revision 1/2, locked).
 * Quote submission DTO — same `.strict()` discipline as rfqs.ts: a client
 * submitting a server-controlled field gets an explicit 400, never a silent
 * drop.
 *
 * ────────────────────────────────────────────────────────────
 * NEVER accepted anywhere in this file:
 * ────────────────────────────────────────────────────────────
 *   id / rfqSupplierId / status / submittedAt / payloadHash
 *                    — server-derived (Quote is created only on final
 *                      submit, status is always SUBMITTED, Revision 1 D22/D23).
 *   idempotencyKey   — deliberately not a Quote field at all; the existing
 *                      Quote.rfqSupplierId unique constraint IS the
 *                      idempotency scope (Revision 1 §17/Revision 2).
 *   quantity (per item) / any total/subtotal
 *                    — quantity is always server-copied from RFQItem.quantity
 *                      at submission time, never Supplier-editable
 *                      (Revision 1 D25/D26); totals are always
 *                      server-calculated from authoritative Decimal fields,
 *                      never trusted from the client (Revision 1 D29,
 *                      Revision 1 §23 "no invented VAT/grand-total formula").
 *   supplierId / rfqId / organizationId / any portal token/context field
 *                    — the portal caller's identity/tenant is derived
 *                      entirely from the resolved bearer token
 *                      (PortalAuthGuard), never accepted from the request
 *                      body (Revision 1 D45/§45, §79 security principles).
 */

const currencySchema = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toUpperCase() : v),
  z.string().regex(/^[A-Z]{3}$/, "Must be a 3-letter currency code")
);

/**
 * Short business terms, not long prose — bounded well below
 * supplierInstructions/internalNotes' 5000-char convention (rfqs.ts), closer
 * to the shorter free-text fields elsewhere in this package (e.g.
 * suppliers.ts's addressSchema/websiteSchema at 500).
 */
const shortTermsSchema = z.string().trim().max(500);
/** A Supplier's own quote comment — matches purchase-requests.ts's own `notes` bound (2000), not RFQ's broader 5000-char instructions field. */
const quoteNotesSchema = z.string().trim().max(2000);

/**
 * Upper bound is a deliberate, documented business ceiling — a lead time
 * beyond one year would be extraordinary for a standard procurement RFQ: not
 * derived from any existing repository convention (none exists for a
 * day-count field), chosen here as the smallest defensible sane limit.
 */
const leadTimeDaysSchema = z.number().int().min(0).max(365);

export const submitQuoteItemSchema = z
  .object({
    rfqItemId: z.string().uuid(),
    unitPrice: unitPriceString,
  })
  .strict();

/**
 * `deliveryCost` is validated with the existing `moneyString` (2dp, matches
 * Decimal(18,2)) — reused as-is per Revision 1 D28, not a new helper.
 * `deliveryIncluded === true` requires a canonically-zero `deliveryCost`
 * (Revision 1 §23/§14) — checked via the pure textual `isZeroDecimalString`
 * helper (Phase B final fix), never `Number(...)`/`parseFloat(...)`/unary
 * `+`/`Math.*`: this project's locked rule is that JS floating-point never
 * participates in monetary semantics, full stop, not only where a specific
 * precision edge case could theoretically misfire. `moneyString` has already
 * validated format/precision/sign by the time this runs (Zod's object-level
 * `.refine()` executes after every field schema already parsed
 * successfully) — `isZeroDecimalString` only asks "does this already-valid
 * string mean zero," so "0"/"0.0"/"0.00" are all accepted, "0.01"/"1"/"10.00"
 * are all rejected.
 */
export const submitQuoteSchema = z
  .object({
    currency: currencySchema,
    vatRate: percentString.nullable().optional(),
    vatIncluded: z.boolean(),
    deliveryCost: moneyString,
    deliveryIncluded: z.boolean(),
    leadTimeDays: leadTimeDaysSchema.nullable().optional(),
    paymentTerms: shortTermsSchema.nullable().optional(),
    warranty: shortTermsSchema.nullable().optional(),
    notes: quoteNotesSchema.nullable().optional(),
    items: z.array(submitQuoteItemSchema).min(1, "At least one item is required"),
  })
  .strict()
  .refine((v) => !v.deliveryIncluded || isZeroDecimalString(v.deliveryCost), {
    message: "deliveryCost must be 0 when deliveryIncluded is true",
    path: ["deliveryCost"],
  })
  .refine((v) => new Set(v.items.map((i) => i.rfqItemId)).size === v.items.length, {
    message: "Duplicate rfqItemId in items",
    path: ["items"],
  });

export type SubmitQuoteItemInput = z.infer<typeof submitQuoteItemSchema>;
export type SubmitQuoteInput = z.infer<typeof submitQuoteSchema>;
