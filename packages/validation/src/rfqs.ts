import { z } from "zod";

/**
 * M3.3 Phase B (Architecture Gate Revision 1, locked). DTO shapes for RFQ —
 * same discipline as purchase-requests.ts/suppliers.ts: every object schema
 * uses `.strict()`, so a client submitting a server-controlled field gets an
 * explicit 400, never a silent drop.
 *
 * ────────────────────────────────────────────────────────────
 * NEVER accepted anywhere in this file:
 * ────────────────────────────────────────────────────────────
 *   id / organizationId / rfqNumber / status / createdById / createdAt /
 *   sentAt / closedAt / cancelledAt / idempotencyKey / payloadHash
 *                    — server-derived (tenant context, CurrentUser(),
 *                      EntitySequence, named action endpoints only).
 *   RFQItem/RFQSupplier snapshot fields (itemName, skuSnapshot, quantity,
 *   uomCode, supplierCodeSnapshot, companyNameSnapshot, ...)
 *                    — always server-derived from the referenced
 *                      PurchaseRequestItem/Supplier at add/send time, never
 *                      client-writable (Revision 1 D6/§14).
 *   portalTokenHash / tokenExpiresAt / invitedAt / RfqSupplierStatus.INVITED
 *                    — M3.3 never mints a token or transitions a supplier
 *                      past SELECTED; that is the Supplier Portal phase's
 *                      job (Revision 1 §2).
 *
 * ────────────────────────────────────────────────────────────
 * DEVIATION FROM THE ARCHITECTURE REPORT (verified against actual
 * repository convention, per this phase's own §2/§3 instruction not to
 * blindly copy the report's line examples):
 * ────────────────────────────────────────────────────────────
 *   The report's §37 listed `sendRfqSchema {}`. purchase-requests.ts's own
 *   comment states submit/approve/cancel "intentionally have NO schema
 *   exported here... inventing an empty `.strict({})` body schema 'just in
 *   case' was explicitly out of scope." RFQ's send action takes no business
 *   input either (path param only), so — to match the ACTUAL established
 *   convention rather than the report's placeholder — no `sendRfqSchema` is
 *   exported here. `closeRfqSchema`/`cancelRfqSchema` DO take real optional
 *   input (a reason), so they follow rejectPurchaseRequestSchema's pattern
 *   instead and ARE exported.
 */

export const rfqStatusValues = ["DRAFT", "SENT", "IN_PROGRESS", "CLOSED", "CANCELLED"] as const;
export type RfqStatusValue = (typeof rfqStatusValues)[number];

export const rfqSupplierStatusValues = ["SELECTED", "INVITED", "VIEWED", "SUBMITTED", "DECLINED", "EXPIRED"] as const;
export type RfqSupplierStatusValue = (typeof rfqSupplierStatusValues)[number];

/**
 * Same clearable() shape as suppliers.ts (Final Hardening fix) — `omitted`
 * leaves the field unchanged, an explicit `null` clears it to DB NULL, and a
 * trimmed-to-empty string ALSO clears it to null. Not exported/shared across
 * files — same per-file convention already established by suppliers.ts.
 */
function clearable<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (typeof v === "string" && v.trim().length === 0 ? null : v), schema.nullable());
}

const supplierInstructionsSchema = z.string().trim().max(5000);
const internalNotesSchema = z.string().trim().max(5000);
/**
 * A real instant with an explicit offset/Z (Revision 1 §24) — deliberately
 * NOT the UTC-midnight business-date convention that PurchaseRequestItem/
 * RFQItem.requiredDate use (Revision 1 §16/§17): a response deadline's
 * time-of-day genuinely matters (e.g. "17:00 Tashkent" is a materially
 * different cutoff than "00:00 UTC" the same calendar day).
 */
const deadlineSchema = z.string().datetime({ offset: true });
const reasonSchema = z.string().trim().min(1, "reason is required").max(1000);

// ────────────────────────────────────────────────────────────
// CREATE
// ────────────────────────────────────────────────────────────

/**
 * Revision 1 D80/§19: a DRAFT RFQ may exist with zero items and zero
 * suppliers — both arrays default to `[]` and are NOT `.min(1)`-gated here.
 * Phase C's send action enforces `>= 1` of each at that point, not create.
 * Both arrays are SET semantics — duplicate ids are rejected at validation
 * (Revision 1 §20/§22), not silently deduplicated, so a client always gets
 * an explicit 400 for a malformed request rather than a surprising diff
 * between what it sent and what got created.
 */
export const createRfqSchema = z
  .object({
    purchaseRequestId: z.string().uuid(),
    purchaseRequestItemIds: z
      .array(z.string().uuid())
      .default([])
      .refine((a) => new Set(a).size === a.length, "purchaseRequestItemIds must not contain duplicates"),
    supplierIds: z
      .array(z.string().uuid())
      .default([])
      .refine((a) => new Set(a).size === a.length, "supplierIds must not contain duplicates"),
    deadline: deadlineSchema.nullable().optional(),
    supplierInstructions: supplierInstructionsSchema.nullable().optional(),
    internalNotes: internalNotesSchema.nullable().optional(),
    idempotencyKey: z.string().trim().min(1).max(128).optional(),
  })
  .strict();
export type CreateRfqInput = z.infer<typeof createRfqSchema>;

// ────────────────────────────────────────────────────────────
// UPDATE (DRAFT header only)
// ────────────────────────────────────────────────────────────

export const updateRfqSchema = z
  .object({
    deadline: clearable(deadlineSchema).optional(),
    supplierInstructions: clearable(supplierInstructionsSchema).optional(),
    internalNotes: clearable(internalNotesSchema).optional(),
  })
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, "At least one field must be provided");
export type UpdateRfqInput = z.infer<typeof updateRfqSchema>;

// ────────────────────────────────────────────────────────────
// LIST QUERY
// ────────────────────────────────────────────────────────────

export const listRfqsQuerySchema = z
  .object({
    search: z.string().trim().min(1).max(100).optional(),
    status: z.enum(rfqStatusValues).optional(),
    purchaseRequestId: z.string().uuid().optional(),
    createdAtFrom: z.string().datetime().optional(),
    createdAtTo: z.string().datetime().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.createdAtFrom && data.createdAtTo && new Date(data.createdAtFrom) > new Date(data.createdAtTo)) {
      ctx.addIssue({ code: "custom", message: "createdAtFrom must not be after createdAtTo", path: ["createdAtFrom"] });
    }
  });
export type ListRfqsQuery = z.infer<typeof listRfqsQuerySchema>;

// ────────────────────────────────────────────────────────────
// DRAFT ITEM / SUPPLIER MUTATION (Revision 1 §8/§31-32 — Phase C wires the
// actual RFQ-lock + tenant/ACTIVE checks; this file only validates shape)
// ────────────────────────────────────────────────────────────

export const addRfqItemSchema = z.object({ purchaseRequestItemId: z.string().uuid() }).strict();
export type AddRfqItemInput = z.infer<typeof addRfqItemSchema>;

export const addRfqSupplierSchema = z.object({ supplierId: z.string().uuid() }).strict();
export type AddRfqSupplierInput = z.infer<typeof addRfqSupplierSchema>;

// ────────────────────────────────────────────────────────────
// ACTION ENDPOINTS
// ────────────────────────────────────────────────────────────

/** Close reason is audit-context-only — never persisted as its own RFQ column (Revision 1 §11). */
export const closeRfqSchema = z.object({ reason: reasonSchema.optional() }).strict();
export type CloseRfqInput = z.infer<typeof closeRfqSchema>;

/** Cancel reason IS persisted (RFQ.cancelReason) — a business lifecycle outcome, unlike close (Revision 1 §12). */
export const cancelRfqSchema = z.object({ reason: reasonSchema.optional() }).strict();
export type CancelRfqInput = z.infer<typeof cancelRfqSchema>;

// send intentionally has NO schema exported here — see the file-level
// DEVIATION note above; it takes no business input (path param only).
