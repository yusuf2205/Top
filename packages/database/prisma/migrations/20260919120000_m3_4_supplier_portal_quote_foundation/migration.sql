-- M3.4 Supplier Portal Phase B — Quote/QuoteItem Schema Foundation
-- (Architecture Gate + Revision 1 + Revision 2, locked), amended by the
-- Multi-Channel Quote Intake Addendum (still migration 15 — this migration
-- was UNCOMMITTED/UNPUSHED/NOT DEPLOYED at addendum time, so it is edited in
-- place rather than followed by a migration 16, per the addendum's explicit
-- instruction).
--
-- Three changes, all additive:
--   1. quotes.payloadHash (nullable) — submit-idempotency scope, per
--      Revision 1 §17/Revision 2: no separate idempotencyKey, the existing
--      Quote.rfqSupplierId unique constraint is already the natural scope.
--   2. UNIQUE(quoteId, rfqItemId) on quote_items — defense-in-depth against
--      duplicate lines within one Quote.
--   3. quotes.source (nullable QuoteSource enum) — Multi-Channel Quote
--      Intake Addendum §5/§6: records which intake channel created the
--      Quote (PORTAL now; MANUAL/FILE_IMPORT/EMAIL/TELEGRAM/WHATSAPP in
--      future phases). Nullable with NO default and NO backfill — an
--      existing/legacy row must never be falsely relabeled as any specific
--      channel (Addendum §5).
--
-- SAFETY: unlike M3.3's RFQ migration, this one does NOT assume the tables
-- are empty (Phase B §5/§20 explicitly forbid that assumption even though
-- Quote/QuoteItem currently have zero business code anywhere in this repo).
-- Changes 1 and 3 are plain nullable ADD COLUMNs — always safe regardless of
-- existing row count, no guard needed. Change 2 is guarded by an explicit
-- pre-check: if any (quoteId, rfqItemId) pair is already duplicated, the
-- migration aborts atomically (Postgres DDL is transactional) with a clear
-- diagnostic naming the exact offending pairs, rather than silently
-- deleting, merging, or reinterpreting any financial row.

-- ════════════════════════════════════════════════════════════
-- PHASE 1 — Quote.payloadHash (always safe, no guard needed)
-- ════════════════════════════════════════════════════════════

ALTER TABLE "quotes" ADD COLUMN "payloadHash" TEXT;

-- ════════════════════════════════════════════════════════════
-- PHASE 1B — QuoteSource enum + Quote.source (always safe, no guard
-- needed — nullable, no default, no backfill)
-- ════════════════════════════════════════════════════════════

CREATE TYPE "QuoteSource" AS ENUM ('PORTAL', 'MANUAL', 'FILE_IMPORT', 'EMAIL', 'TELEGRAM', 'WHATSAPP');

ALTER TABLE "quotes" ADD COLUMN "source" "QuoteSource";

-- ════════════════════════════════════════════════════════════
-- PHASE 2 — defensive duplicate guard for (quoteId, rfqItemId)
-- ════════════════════════════════════════════════════════════

DO $$
DECLARE
  dup_count int;
  dup_summary text;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT "quoteId", "rfqItemId"
    FROM "quote_items"
    GROUP BY "quoteId", "rfqItemId"
    HAVING COUNT(*) > 1
  ) AS dups;

  IF dup_count > 0 THEN
    SELECT string_agg(format('(quoteId=%s, rfqItemId=%s, rows=%s)', "quoteId", "rfqItemId", cnt), ', ')
    INTO dup_summary
    FROM (
      SELECT "quoteId", "rfqItemId", COUNT(*) AS cnt
      FROM "quote_items"
      GROUP BY "quoteId", "rfqItemId"
      HAVING COUNT(*) > 1
    ) AS dups;

    RAISE EXCEPTION 'M3.4 Supplier Portal migration blocked: % duplicate QuoteItem (quoteId, rfqItemId) pair(s) exist and require manual financial-data reconciliation before schema upgrade — offending pairs: %', dup_count, dup_summary;
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════
-- PHASE 3 — UNIQUE(quoteId, rfqItemId) (only reached if Phase 2 passed)
-- ════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX "quote_items_quoteId_rfqItemId_key" ON "quote_items"("quoteId", "rfqItemId");
