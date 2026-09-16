import { z } from "zod";
import { decimalString, moneyString } from "./decimal";
import { uomCodeValues } from "./uom";

/**
 * M3.1 Phase C (Architecture Gate Revision 1). DTO shapes for Purchase
 * Request — SHAPE and INPUT SAFETY only, same discipline as
 * stock-movements.ts: every object schema here uses `.strict()`, not the
 * package's default silent-key-stripping, so a client submitting a
 * server-controlled field gets an explicit 400, never a silent drop.
 *
 * ────────────────────────────────────────────────────────────
 * NEVER accepted anywhere in this file:
 * ────────────────────────────────────────────────────────────
 *   id / organizationId / requesterId / requestNumber
 *                    — server-derived (tenant context, CurrentUser(),
 *                      EntitySequence — see Phase B/C reports).
 *   status / submittedAt / assignedBuyerUserId / cancelledAt /
 *   cancelledByUserId / payloadHash
 *                    — status changes only through the future named action
 *                      endpoints (submit/approve/reject/cancel/assign), never
 *                      a generic body field; payloadHash is server-computed
 *                      (Phase D) from a canonicalized copy of the input, not
 *                      a client-supplied value.
 *   skuSnapshot      — always server-derived from Product when productId is
 *                      given (see PRODUCT-BACKED ITEM below), never
 *                      client-writable, in ANY mode.
 *   createdAt / updatedAt
 *                    — DB-managed.
 *
 * ────────────────────────────────────────────────────────────
 * ITEM MODE (create / add) — mutually exclusive, never both, never neither:
 * ────────────────────────────────────────────────────────────
 *   PRODUCT-BACKED: productId given. itemName/skuSnapshot are then
 *   forbidden on the wire (server derives both from Product at write time —
 *   a historical snapshot, never re-read from current Product state later).
 *   FREE-TEXT: productId absent. itemName is then required (what was
 *   actually requested, when no Product Master row exists for it yet).
 *
 * Item UPDATE (Phase C, DRAFT-only) deliberately does NOT expose productId/
 * itemName/skuSnapshot at all — switching an item's product identity via a
 * partial PATCH would make snapshot semantics non-deterministic and audit
 * history unclear (Architecture Gate Revision 1, §21: remove + re-add
 * instead, if that's ever needed).
 */

export const purchaseRequestStatusValues = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_APPROVAL",
  "APPROVED",
  "REJECTED",
  "RFQ_IN_PROGRESS",
  "PO_CREATED",
  "CLOSED",
  "CANCELLED",
] as const;
export type PurchaseRequestStatusValue = (typeof purchaseRequestStatusValues)[number];

export const purchaseRequestPriorityValues = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type PurchaseRequestPriorityValue = (typeof purchaseRequestPriorityValues)[number];

/** Same composition pattern already used by stock-movements.ts's positiveQuantityString — decimalString (Decimal(18,3)) + a positivity refine, not a new precision tier. */
const positiveQuantityString = decimalString.refine((v) => Number(v) > 0, "Must be greater than zero");

/**
 * Loose freeform technical-spec bag — same conceptual role as
 * RFQItem.technicalSpec/QuoteItem's sibling field: unlike
 * MaterialSpecification.attributes (a carefully typed, product-master-wide
 * vocabulary), this is a per-line scratch payload. Bounded by serialized
 * size only, not a fixed key/value vocabulary — deliberately not
 * over-engineered for what Phase C actually needs.
 */
const technicalSpecSchema = z
  .record(z.string(), z.unknown())
  .refine((obj) => JSON.stringify(obj).length <= 10_000, "technicalSpec is too large (max 10,000 characters serialized)");

const currencyCodeSchema = z.string().trim().regex(/^[A-Z]{3}$/, "Must be a 3-letter ISO 4217 currency code");

// ────────────────────────────────────────────────────────────
// ITEM — shared shape for both CREATE (nested in createPurchaseRequestSchema)
// and the future dedicated "add item" endpoint.
// ────────────────────────────────────────────────────────────

export const purchaseRequestItemInputSchema = z
  .object({
    productId: z.string().uuid().optional(),
    itemName: z.string().trim().min(1).max(300).optional(),
    description: z.string().trim().max(2000).optional(),
    quantity: positiveQuantityString,
    uomCode: z.enum(uomCodeValues),
    technicalSpec: technicalSpecSchema.optional(),
    requiredDate: z.string().datetime().optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const isProductBacked = data.productId !== undefined;
    if (isProductBacked) {
      if (data.itemName !== undefined) {
        ctx.addIssue({
          code: "custom",
          message: "itemName is server-derived from Product when productId is given — do not supply it",
          path: ["itemName"],
        });
      }
    } else if (!data.itemName) {
      ctx.addIssue({
        code: "custom",
        message: "itemName is required when productId is not given (free-text item)",
        path: ["itemName"],
      });
    }
  });
export type PurchaseRequestItemInput = z.infer<typeof purchaseRequestItemInputSchema>;

/**
 * Deliberately excludes productId/itemName/skuSnapshot entirely (Architecture
 * Gate Revision 1 §21) — a DRAFT item's product identity is immutable once
 * created; changing it means remove + add, not a partial update.
 */
export const updatePurchaseRequestItemSchema = z
  .object({
    quantity: positiveQuantityString.optional(),
    uomCode: z.enum(uomCodeValues).optional(),
    description: z.string().trim().max(2000).optional(),
    technicalSpec: technicalSpecSchema.optional(),
    requiredDate: z.string().datetime().optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, "At least one field must be provided");
export type UpdatePurchaseRequestItemInput = z.infer<typeof updatePurchaseRequestItemSchema>;

// ────────────────────────────────────────────────────────────
// CREATE
// ────────────────────────────────────────────────────────────

/**
 * A PR is not a meaningful request with zero items (Architecture Gate
 * Revision 1) — at least one line required. Max 100 is a practical MVP
 * abuse bound (the prompt's own suggested figure; no existing repo
 * precedent sets a line-count cap on a similar nested-array create, so this
 * establishes one specific to PR rather than borrowing an unrelated number).
 */
export const createPurchaseRequestSchema = z
  .object({
    departmentId: z.string().uuid().optional(),
    categoryId: z.string().uuid().optional(),
    priority: z.enum(purchaseRequestPriorityValues).optional(),
    requiredDate: z.string().datetime().optional(),
    reason: z.string().trim().max(2000).optional(),
    estimatedBudget: moneyString.optional(),
    currency: currencyCodeSchema.optional(),
    idempotencyKey: z.string().trim().min(1).max(128).optional(),
    items: z.array(purchaseRequestItemInputSchema).min(1, "At least one item is required").max(100, "At most 100 items per request"),
  })
  .strict();
export type CreatePurchaseRequestInput = z.infer<typeof createPurchaseRequestSchema>;

// ────────────────────────────────────────────────────────────
// UPDATE (DRAFT header only)
// ────────────────────────────────────────────────────────────

export const updatePurchaseRequestSchema = z
  .object({
    departmentId: z.string().uuid().optional(),
    categoryId: z.string().uuid().optional(),
    priority: z.enum(purchaseRequestPriorityValues).optional(),
    requiredDate: z.string().datetime().optional(),
    reason: z.string().trim().max(2000).optional(),
    estimatedBudget: moneyString.optional(),
    currency: currencyCodeSchema.optional(),
  })
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, "At least one field must be provided");
export type UpdatePurchaseRequestInput = z.infer<typeof updatePurchaseRequestSchema>;

// ────────────────────────────────────────────────────────────
// LIST QUERY
// ────────────────────────────────────────────────────────────

export const listPurchaseRequestsQuerySchema = z
  .object({
    status: z.enum(purchaseRequestStatusValues).optional(),
    requesterUserId: z.string().uuid().optional(),
    assignedBuyerUserId: z.string().uuid().optional(),
    priority: z.enum(purchaseRequestPriorityValues).optional(),
    // Exact-match business filter contract for Phase C — not a prefix/fuzzy
    // search (that belongs to the future Global Search work, out of scope
    // here). The service layer (Phase D+) decides the actual WHERE clause;
    // this only validates shape.
    requestNumber: z.string().trim().min(1).max(50).optional(),
    requiredDate: z.string().datetime().optional(),
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
export type ListPurchaseRequestsQuery = z.infer<typeof listPurchaseRequestsQuerySchema>;

// ────────────────────────────────────────────────────────────
// ACTION ENDPOINTS
// ────────────────────────────────────────────────────────────

/** Assignment/reassignment to a concrete user only — Architecture Gate Revision 1 did not approve an "unassign" (null) contract. Same-org/active/role checks are DB-state-dependent and belong to Phase E's service layer, not Zod. */
export const assignPurchaseRequestSchema = z.object({ assignedBuyerUserId: z.string().uuid() }).strict();
export type AssignPurchaseRequestInput = z.infer<typeof assignPurchaseRequestSchema>;

/** Maps to ApprovalStepInstance.comment server-side (Phase E) — "reason" is the public API name because rejection must answer "why" (Architecture Gate §16). */
export const rejectPurchaseRequestSchema = z.object({ reason: z.string().trim().min(1, "reason is required").max(1000) }).strict();
export type RejectPurchaseRequestInput = z.infer<typeof rejectPurchaseRequestSchema>;

// submit / approve / cancel intentionally have NO schema exported here —
// they take no business input (path params only). Inventing an empty
// `.strict({})` body schema "just in case" was explicitly out of scope.
