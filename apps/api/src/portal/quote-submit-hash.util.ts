import type { SubmitQuoteInput } from "@top/validation";
import { computePayloadHash } from "../common/canonical-hash.util";

/**
 * M3.4 Supplier Portal Phase B (Architecture Revision 1 §21, Revision 2
 * §3/§13). Pure normalization + hash — no DB access, reuses the exact same
 * `computePayloadHash` primitive as `computeRfqCreateHash`
 * (rfqs/rfq-create-hash.util.ts) rather than inventing a second hashing
 * mechanism. Called once, immediately after Zod validation and before any
 * lock/DB read (Revision 2 §3) — the resulting hash is used both by the
 * SUBMITTED-replay branch and the new-submission branch of the (future,
 * Phase C) quote submit transaction.
 *
 * Excludes (Revision 1 §21): server-derived `quantity`, any total,
 * `status`, `submittedAt`, the token, and all portal/RFQ/Supplier context —
 * none of those are part of what the Supplier actually submitted, so
 * including any of them would make an identical retry hash differently
 * depending on when/against-what-state it happened to run. Also excludes
 * `Quote.source` (Multi-Channel Quote Intake Addendum §10) — for this
 * endpoint `source` is always the server-derived constant `"PORTAL"`, never
 * user input, so it cannot vary between retries and must never be hashed.
 *
 * `canonicalizeDecimal` normalizes textual decimal representations
 * ("10"/"10.0"/"10.0000") to the same canonical string via pure string
 * manipulation — never a numeric round-trip, so there is no float-precision
 * risk even for a Decimal(18,4) value at the edge of its range.
 */
function canonicalizeDecimal(raw: string): string {
  const trimmed = raw.trim();
  const dotIndex = trimmed.indexOf(".");
  if (dotIndex === -1) {
    return trimmed.replace(/^0+(?=\d)/, "") || "0";
  }
  const intPart = trimmed.slice(0, dotIndex);
  const fracPart = trimmed.slice(dotIndex + 1).replace(/0+$/, "");
  const normalizedInt = intPart.replace(/^0+(?=\d)/, "") || "0";
  return fracPart ? `${normalizedInt}.${fracPart}` : normalizedInt;
}

export function computeQuoteSubmitHash(input: SubmitQuoteInput): string {
  const normalized = {
    currency: input.currency.trim().toUpperCase(),
    vatRate: input.vatRate ? canonicalizeDecimal(input.vatRate) : null,
    vatIncluded: input.vatIncluded,
    deliveryCost: canonicalizeDecimal(input.deliveryCost),
    deliveryIncluded: input.deliveryIncluded,
    leadTimeDays: input.leadTimeDays ?? null,
    paymentTerms: input.paymentTerms?.trim() || null,
    warranty: input.warranty?.trim() || null,
    notes: input.notes?.trim() || null,
    items: [...input.items]
      .sort((a, b) => a.rfqItemId.localeCompare(b.rfqItemId))
      .map((i) => ({ rfqItemId: i.rfqItemId, unitPrice: canonicalizeDecimal(i.unitPrice) })),
  };
  return computePayloadHash(normalized);
}
