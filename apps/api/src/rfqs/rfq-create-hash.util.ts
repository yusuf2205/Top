import type { CreateRfqInput } from "@top/validation";
import { computePayloadHash } from "../common/canonical-hash.util";

/**
 * M3.3 Phase B (Architecture Gate Revision 1, §21/§38). Pure normalization +
 * hash — no DB access, no dependency on any RFQ service (none exists yet;
 * Phase C's future create() imports this directly, same shape as
 * PurchaseRequestsService's own private computeCreateHash).
 *
 * WHY normalization is required here and wasn't for PurchaseRequest/Supplier:
 * `computePayloadHash`'s `canonicalize()` (common/canonical-hash.util.ts)
 * recursively sorts OBJECT KEYS but deliberately does not reorder ARRAY
 * ELEMENTS — confirmed by direct inspection of that file. RFQ create is the
 * first payload in this codebase whose idempotency-relevant shape includes
 * order-insensitive arrays (`purchaseRequestItemIds`/`supplierIds` are SET
 * semantics — Revision 1 §20): two requests selecting the same items/
 * suppliers in a different order describe the identical RFQ and MUST hash
 * identically, or a client that reorders its own array between an original
 * request and a retry would incorrectly get a 409 hash-mismatch instead of
 * the idempotent replay it actually asked for.
 *
 * `idempotencyKey` is excluded from the hashable payload, matching
 * PurchaseRequestsService.computeCreateHash's own convention. `deadline` is
 * normalized to its persisted ISO-instant form so two offset-equivalent
 * input strings (e.g. same instant expressed with a different UTC offset)
 * hash identically. `undefined` and `null` are normalized to the same `null`
 * for supplierInstructions/internalNotes/deadline — omitting a field and
 * explicitly sending `null` both mean "no value" and must hash the same way.
 */
export function computeRfqCreateHash(input: CreateRfqInput): string {
  const normalized = {
    purchaseRequestId: input.purchaseRequestId,
    purchaseRequestItemIds: [...new Set(input.purchaseRequestItemIds)].sort(),
    supplierIds: [...new Set(input.supplierIds)].sort(),
    deadline: input.deadline ? new Date(input.deadline).toISOString() : null,
    supplierInstructions: input.supplierInstructions ?? null,
    internalNotes: input.internalNotes ?? null,
  };
  return computePayloadHash(normalized);
}
