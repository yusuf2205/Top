import { createHash } from "node:crypto";

/**
 * M3.1 Phase D: extracted from StockMovementsService (M2.5 Phase F), where
 * this algorithm was first built and proven — byte-identical behavior, no
 * change to StockMovement's hash semantics. Reused by both
 * StockMovementsService and PurchaseRequestsService's idempotency
 * contracts, so a "same semantic payload -> same hash" guarantee only needs
 * to be correct in one place.
 *
 * Recursively sorts object keys so JSON.stringify produces a deterministic
 * string regardless of property insertion order.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** SHA-256 over the canonicalized (recursively key-sorted) JSON of `input`. */
export function computePayloadHash(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(input))).digest("hex");
}
