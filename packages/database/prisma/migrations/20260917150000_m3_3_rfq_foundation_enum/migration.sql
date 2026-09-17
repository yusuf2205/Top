-- M3.3 RFQ Phase B — Schema Foundation (Architecture Gate Revision 1, locked).
--
-- SPLIT FROM the original single-file `20260917150000_m3_3_rfq_foundation`
-- migration (Phase C defect fix, backend contract defect policy). A real
-- `prisma migrate deploy` run proved the original combined file cannot ever
-- apply: PostgreSQL forbids referencing a newly-added enum value within the
-- SAME transaction that added it —
--   ERROR: unsafe use of new value "SELECTED" of enum type "RfqSupplierStatus"
--   HINT: New enum values must be committed before they can be used.
-- The original file's Phase 1 comment ("PostgreSQL 12+ allows a newly added
-- enum value to be used later in the SAME transaction ... proven empirically")
-- was factually wrong — PG12 only lifted the restriction on running
-- `ALTER TYPE ... ADD VALUE` inside a transaction block at all; it did NOT
-- lift the restriction on *using* the new value before that transaction
-- commits. Fix: split into two migrations so the ADD VALUE commits before
-- anything (the companion migration's `SET DEFAULT 'SELECTED'`) references
-- it. The resulting schema is identical to the original single-file design —
-- only the transaction boundary changed.
--
-- SAFETY: same fail-closed guard as the companion migration (kept here too,
-- so this file stays independently fail-closed even if ever run alone).

-- ════════════════════════════════════════════════════════════
-- PHASE 0 — FAIL-CLOSED LEGACY-DATA GUARD (must run first)
-- ════════════════════════════════════════════════════════════

DO $$
DECLARE row_count int;
BEGIN
  SELECT
    (SELECT COUNT(*) FROM "rfqs") +
    (SELECT COUNT(*) FROM "rfq_items") +
    (SELECT COUNT(*) FROM "rfq_suppliers")
  INTO row_count;
  IF row_count > 0 THEN
    RAISE EXCEPTION 'M3.3 RFQ migration blocked: legacy RFQ data exists (% row(s) across rfqs/rfq_items/rfq_suppliers) and requires manual reconciliation before schema upgrade', row_count;
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════
-- PHASE 1 — RfqSupplierStatus: add SELECTED as the new first/default value
-- (Revision 1 §5/§25/§33). Must be its own migration/transaction — see the
-- header note above for why the value cannot be referenced until this
-- transaction commits.
-- ════════════════════════════════════════════════════════════

ALTER TYPE "RfqSupplierStatus" ADD VALUE 'SELECTED' BEFORE 'INVITED';
