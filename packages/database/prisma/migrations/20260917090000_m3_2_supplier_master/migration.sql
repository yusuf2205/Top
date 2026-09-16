-- M3.2 Supplier Master (Architecture Gate Revision 1, locked).
--
-- SAFETY: this migration does NOT assume `suppliers`/`supplier_contacts`
-- are empty (Revision 1 R1/R2 — established from code inspection only, a
-- live-database row count was deliberately never queried during the
-- architecture gate). Every step below is a deterministic backfill-then-
-- constrain sequence that behaves correctly whether those tables hold 0 or
-- many rows. Two explicit guards (duplicate normalizedTin, duplicate active
-- primary contact) deliberately ABORT the whole migration with a clear
-- RAISE EXCEPTION rather than silently merge/delete/rename data if legacy
-- rows would violate a new uniqueness invariant (Revision 1 R7/R8, R15/R19,
-- R36 — "fail clearly, never auto-merge").

-- ════════════════════════════════════════════════════════════
-- PHASE 1 — active (Boolean) -> status (SupplierStatus)
-- Revision 1 R2/R3: create enum -> add nullable status -> backfill every
-- existing row deterministically -> NOT NULL -> only then drop active.
-- ════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN "status" "SupplierStatus";

-- BLOCKED/ARCHIVED have no legacy equivalent and are never assigned here.
UPDATE "suppliers" SET "status" = CASE WHEN "active" THEN 'ACTIVE' ELSE 'INACTIVE' END::"SupplierStatus";

ALTER TABLE "suppliers" ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "suppliers" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
ALTER TABLE "suppliers" DROP COLUMN "active";

-- ════════════════════════════════════════════════════════════
-- PHASE 2 — supplierCode (deterministic backfill + EntitySequence init)
-- Revision 1 R3/R4: order existing suppliers per org by (createdAt ASC, id
-- ASC), assign SUP-000001.. sequentially, then initialize EntitySequence so
-- the NEXT created supplier continues from max(existing)+1 with no
-- collision, no reuse, no reset.
-- ════════════════════════════════════════════════════════════

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN "supplierCode" TEXT;

WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "organizationId" ORDER BY "createdAt" ASC, "id" ASC
  ) AS rn
  FROM "suppliers"
)
UPDATE "suppliers" s
SET "supplierCode" = 'SUP-' || LPAD(ranked.rn::text, 6, '0')
FROM ranked
WHERE s."id" = ranked."id";

ALTER TABLE "suppliers" ALTER COLUMN "supplierCode" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_organizationId_supplierCode_key" ON "suppliers"("organizationId", "supplierCode");

-- Seeds entity_sequences(SUPPLIER, <sentinel year>) per organization that
-- already has suppliers, with lastValue = the count just assigned above —
-- so EntitySequenceService.nextValue()'s existing increment-then-read path
-- hands the very next created supplier max(existing)+1, unchanged. `9999`
-- here MUST stay byte-identical to SUPPLIER_SEQUENCE_YEAR in
-- apps/api/src/common/entity-sequence/entity-sequence.service.ts (Revision
-- 1 R5) — never a real calendar year, never shown to a user. Organizations
-- with zero suppliers get no row, which nextValue()'s own "0 matched ->
-- create with lastValue=1" branch already handles correctly.
--
-- Final Hardening fix: ON CONFLICT ... DO UPDATE with GREATEST, not a plain
-- INSERT. A plain INSERT would raise a raw 23505 unique-violation (aborting
-- the whole migration) if a SUPPLIER/9999 row for this org already existed
-- for any reason — and, worse, if that row's own lastValue were ever HIGHER
-- than this backfill's count, a naive overwrite would silently RESET the
-- counter backwards, which is exactly the "no reset" invariant this
-- migration exists to uphold (Revision 1 §4/§27). GREATEST makes the
-- initialization safe regardless of which value already exists.
INSERT INTO "entity_sequences" ("id", "organizationId", "sequenceType", "year", "lastValue")
SELECT gen_random_uuid()::text, "organizationId", 'SUPPLIER', 9999, COUNT(*)
FROM "suppliers"
GROUP BY "organizationId"
ON CONFLICT ("organizationId", "sequenceType", "year")
DO UPDATE SET "lastValue" = GREATEST("entity_sequences"."lastValue", EXCLUDED."lastValue");

-- ════════════════════════════════════════════════════════════
-- PHASE 3 — normalizedTin (derived) + uniqueness
-- Revision 1 R6/R7/R8: plain composite @@unique (Postgres never treats two
-- NULLs as equal, even in a multi-column unique index — no partial index
-- needed here, unlike the primary-contact case in Phase 6). A pre-flight
-- guard aborts the whole migration if legacy data already contains a
-- same-org duplicate normalizedTin, rather than silently merging/renaming.
-- ════════════════════════════════════════════════════════════

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN "normalizedTin" TEXT;

-- trim + strip whitespace/hyphens + uppercase; an all-stripped result
-- becomes NULL via NULLIF, never an empty string (Revision 1 R6).
UPDATE "suppliers"
SET "normalizedTin" = NULLIF(UPPER(REGEXP_REPLACE("tin", '[\s-]', '', 'g')), '')
WHERE "tin" IS NOT NULL;

DO $$
DECLARE dup_count int;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT "organizationId", "normalizedTin" FROM "suppliers"
    WHERE "normalizedTin" IS NOT NULL
    GROUP BY "organizationId", "normalizedTin"
    HAVING COUNT(*) > 1
  ) d;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'M3.2 migration blocked: % duplicate (organizationId, normalizedTin) group(s) found in suppliers — resolve manually before retrying', dup_count;
  END IF;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_organizationId_normalizedTin_key" ON "suppliers"("organizationId", "normalizedTin");

-- ════════════════════════════════════════════════════════════
-- PHASE 4 — countryCode (new, ISO alpha-2) alongside legacy country
-- Revision 1 R8/R9/R10: `country` is NEVER dropped or rewritten — it stays
-- as a permanent legacy/reserved column so no historical value is ever
-- silently discarded. Only the deterministic exact-2-letter case is
-- backfilled into the new column; free text (e.g. "Uzbekistan") is left
-- with countryCode = NULL, `country` itself untouched. No default — unknown
-- stays NULL, never silently becomes 'UZ'.
-- ════════════════════════════════════════════════════════════

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN "countryCode" CHAR(2);

UPDATE "suppliers" SET "countryCode" = UPPER("country") WHERE "country" ~ '^[A-Za-z]{2}$';

-- ════════════════════════════════════════════════════════════
-- PHASE 5 — company-level contact fields + internal notes (new, no legacy
-- data to backfill). Revision 1 R10/D16 (phone/email/website), R25 (notes —
-- internal procurement text, never exposed through any future
-- Supplier-Portal-facing DTO).
-- ════════════════════════════════════════════════════════════

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN "phone" TEXT,
ADD COLUMN "email" TEXT,
ADD COLUMN "website" TEXT,
ADD COLUMN "notes" TEXT;

-- ════════════════════════════════════════════════════════════
-- PHASE 6 — SupplierContact: position/active/timestamps + primary-contact
-- invariant. `active`/`createdAt`/`updatedAt` use a constant DEFAULT so
-- every pre-existing contact row is backfilled in the same statement
-- (Postgres allows NOT NULL ADD COLUMN with a DEFAULT on a populated
-- table). A pre-flight guard aborts the whole migration if any legacy
-- supplier already has more than one active isPrimary contact.
-- ════════════════════════════════════════════════════════════

-- AlterTable
ALTER TABLE "supplier_contacts" ADD COLUMN "position" TEXT,
ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

DO $$
DECLARE dup_count int;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT "supplierId" FROM "supplier_contacts" WHERE "isPrimary" AND "active"
    GROUP BY "supplierId" HAVING COUNT(*) > 1
  ) d;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'M3.2 migration blocked: % supplier(s) already have more than one active primary contact — resolve manually before retrying', dup_count;
  END IF;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "supplier_contacts_one_active_primary_per_supplier" ON "supplier_contacts"("supplierId") WHERE "isPrimary" = true AND "active" = true;

-- ════════════════════════════════════════════════════════════
-- PHASE 7 — rating bound (Revision 1 R7/R22)
-- The CHECK constraint itself is the "fail clearly" guard: if any legacy
-- row's rating already falls outside [1,5], Postgres refuses this
-- statement with a clear constraint-violation error — no separate DO
-- block needed, unlike Phases 3/6 above (those needed a custom guard
-- because a plain unique/partial index gives no descriptive message).
-- ════════════════════════════════════════════════════════════

ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_rating_range" CHECK ("rating" IS NULL OR ("rating" >= 1 AND "rating" <= 5));

-- ════════════════════════════════════════════════════════════
-- PHASE 8 — create idempotency (Revision 1 R19/R27)
-- Same hand-added-partial-index pattern as purchase_requests/
-- stock_movements — a NULL idempotencyKey never collides with another
-- NULL; two non-NULL keys collide only within the same organization.
-- Create-only; never referenced by any update path.
-- ════════════════════════════════════════════════════════════

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN "idempotencyKey" TEXT,
ADD COLUMN "payloadHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_organizationId_idempotencyKey_key" ON "suppliers"("organizationId", "idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;

-- ════════════════════════════════════════════════════════════
-- PHASE 9 — index for the default list filter (status excludes ARCHIVED by
-- default — Revision 1 §28).
-- ════════════════════════════════════════════════════════════

-- CreateIndex
CREATE INDEX "suppliers_organizationId_status_idx" ON "suppliers"("organizationId", "status");

-- DropIndex (superseded by the composite index above)
DROP INDEX "suppliers_organizationId_idx";
