-- M3.3 RFQ Phase B — Schema Foundation (Architecture Gate Revision 1, locked).
--
-- Second half of the split migration — see the companion migration
-- `20260917150000_m3_3_rfq_foundation_enum` for the full rationale (Phase C
-- backend contract defect policy fix), Phase 0 (the fail-closed legacy-data
-- guard) and Phase 1 (the `RfqSupplierStatus.SELECTED` enum addition, which
-- must commit in its own transaction before 'SELECTED' can be referenced
-- below, e.g. in Phase 4's `SET DEFAULT 'SELECTED'`). The guard is re-run
-- here too, so this migration remains independently fail-closed against the
-- same legacy-data condition even if it were ever run on its own.
--
-- SAFETY: unlike M3.1/M3.2, this migration does NOT rely on a code-inspection
-- argument that `rfqs`/`rfq_items`/`rfq_suppliers` are empty — Revision 1
-- §30-32 explicitly required an empirically-enforced fail-closed guard,
-- because `RFQSupplier.portalToken` is a plaintext bearer credential that
-- must NEVER be copied or reinterpreted as a hash, and `RFQItem` has no safe
-- way to infer a `purchaseRequestItemId` for a pre-existing row. If ANY row
-- exists in any of the three RFQ tables, this migration aborts atomically
-- (Postgres DDL is transactional — the whole file rolls back together)
-- before making any irreversible change below.

-- ════════════════════════════════════════════════════════════
-- PHASE 0 — FAIL-CLOSED LEGACY-DATA GUARD (re-run; see header note above)
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
-- PHASE 2 — RFQ header (Revision 1 §6-11)
-- deadline becomes nullable (a DRAFT RFQ may not have one yet — D80);
-- supplierInstructions/internalNotes/lifecycle timestamps/cancelReason/
-- idempotency fields are new; createdById gets its missing User FK.
-- ════════════════════════════════════════════════════════════

ALTER TABLE "rfqs" ALTER COLUMN "deadline" DROP NOT NULL;

ALTER TABLE "rfqs" ADD COLUMN     "supplierInstructions" TEXT,
ADD COLUMN     "internalNotes" TEXT,
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "payloadHash" TEXT;

-- CreateIndex — RFQs are queried by source PR (list/detail/source-PR flows);
-- Postgres does not automatically index a plain FK column (Revision 1 §6).
CREATE INDEX "rfqs_organizationId_purchaseRequestId_idx" ON "rfqs"("organizationId", "purchaseRequestId");

-- CreateIndex — create-idempotency (Revision 1 D8/§21-22), same hand-appended
-- partial-unique-index pattern as purchase_requests/suppliers/stock_movements.
CREATE UNIQUE INDEX "rfqs_organizationId_idempotencyKey_key" ON "rfqs"("organizationId", "idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;

-- AddForeignKey — createdById already existed as a plain unbound string
-- column; this adds the missing relation (Revision 1 §7/§9). No explicit
-- onDelete override, matching every other User relation on this schema
-- (requesterId/assignedBuyerUserId/cancelledByUserId/invitedById all omit
-- one too) — Prisma/Postgres default (RESTRICT) applies.
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ════════════════════════════════════════════════════════════
-- PHASE 3 — RFQItem: PR-item linkage, product/SKU snapshot, uomCode
-- (Revision 1 D6/§12-18). The guard above already proved this table is
-- empty, so — exactly like M3.1's own `unit` -> `uomCode` migration on
-- purchase_request_items — this is a plain DROP + ADD, never a value cast,
-- and the new NOT NULL columns need no DEFAULT (nothing to backfill).
-- ════════════════════════════════════════════════════════════

ALTER TABLE "rfq_items" DROP COLUMN "unit",
ADD COLUMN     "purchaseRequestItemId" TEXT NOT NULL,
ADD COLUMN     "productId" TEXT,
ADD COLUMN     "skuSnapshot" TEXT,
ADD COLUMN     "uomCode" "UomCode" NOT NULL,
ADD COLUMN     "requiredDate" TIMESTAMP(3),
ADD COLUMN     "internalItemNote" TEXT;

-- CreateIndex — same PR item may be selected into more than one RFQ; only
-- once per RFQ (Revision 1 D6/§15).
CREATE UNIQUE INDEX "rfq_items_rfqId_purchaseRequestItemId_key" ON "rfq_items"("rfqId", "purchaseRequestItemId");

-- AddForeignKey
ALTER TABLE "rfq_items" ADD CONSTRAINT "rfq_items_purchaseRequestItemId_fkey" FOREIGN KEY ("purchaseRequestItemId") REFERENCES "purchase_request_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey — nullable, no explicit onDelete override needed beyond
-- SET NULL: mirrors purchase_request_items.productId's own FK exactly, so a
-- later Product deletion can never break a historical RFQ snapshot
-- (Revision 1 §14/§18).
ALTER TABLE "rfq_items" ADD CONSTRAINT "rfq_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ════════════════════════════════════════════════════════════
-- PHASE 4 — RFQSupplier: identity snapshots, plaintext token removal
-- (Revision 1 §3/§19-21/§30-32). Guard above already proved zero rows
-- exist, so the two snapshot columns may be added as NOT NULL directly, with
-- no backfill. portalToken is DROPPED outright — never renamed, never its
-- value copied into portalTokenHash.
-- ════════════════════════════════════════════════════════════

-- DropIndex — the old plaintext-token uniqueness constraint (was a plain
-- UNIQUE INDEX, not a table CONSTRAINT, in this schema's Prisma-generated
-- convention — see the init migration).
DROP INDEX "rfq_suppliers_portalToken_key";

ALTER TABLE "rfq_suppliers" DROP COLUMN "portalToken",
ADD COLUMN     "supplierCodeSnapshot" TEXT NOT NULL,
ADD COLUMN     "companyNameSnapshot" TEXT NOT NULL,
ADD COLUMN     "portalTokenHash" TEXT,
ALTER COLUMN "tokenExpiresAt" DROP NOT NULL,
ALTER COLUMN "invitedAt" DROP NOT NULL,
ALTER COLUMN "invitedAt" DROP DEFAULT,
ALTER COLUMN "status" SET DEFAULT 'SELECTED';

-- CreateIndex — the replacement, hash-based uniqueness. Nullable: M3.3 never
-- populates this column at all (the Supplier Portal phase does) — a NULL
-- here never collides with another NULL (ordinary Postgres unique-index
-- semantics), matching the idempotencyKey partial-index precedent's own
-- NULL-safety reasoning even though this one isn't partial.
CREATE UNIQUE INDEX "rfq_suppliers_portalTokenHash_key" ON "rfq_suppliers"("portalTokenHash");
