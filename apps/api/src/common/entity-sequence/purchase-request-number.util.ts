/**
 * M3.1 Phase C. Pure formatter — no DB access, no dependency on
 * EntitySequenceService. `year`/`value` come from an already-committed
 * EntitySequence row (Phase D wires this together); this function only
 * knows how to render them.
 *
 * "6-digit" is a MINIMUM display width, not a cap (Architecture Gate
 * Revision 1, Decision 14/§9 of Phase C) — a 7th digit appears naturally
 * once an organization's yearly counter for this sequence type passes
 * 999,999; there is no artificial wrap-around and no reset except via a new
 * (organizationId, sequenceType, year) row.
 */
export function formatPurchaseRequestNumber(year: number, value: number): string {
  return `PR-${year}-${String(value).padStart(6, "0")}`;
}
