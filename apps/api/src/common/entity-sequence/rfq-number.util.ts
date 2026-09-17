/**
 * M3.3 Phase B (Architecture Gate Revision 1, D7). Pure formatter — no DB
 * access, no dependency on EntitySequenceService — same shape as the
 * sibling formatPurchaseRequestNumber. `year`/`value` come from an
 * already-committed EntitySequence row (Phase C wires this together, always
 * with the real calendar year — NEVER Supplier's SUPPLIER_SEQUENCE_YEAR
 * sentinel, since an RFQ number is a per-year document like PR, not a
 * permanent master-data identity like a supplier code).
 *
 * "6-digit" is a MINIMUM display width, not a cap — a 7th digit appears
 * naturally once an organization's yearly RFQ counter passes 999,999; no
 * artificial wrap-around, no reset except via a new
 * (organizationId, "RFQ", year) row.
 */
export function formatRfqNumber(year: number, value: number): string {
  return `RFQ-${year}-${String(value).padStart(6, "0")}`;
}
