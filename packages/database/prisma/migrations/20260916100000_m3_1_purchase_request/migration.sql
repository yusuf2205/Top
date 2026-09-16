-- CreateEnum
CREATE TYPE "PurchaseRequestPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- AlterTable
-- Verified zero rows in purchase_request_items on both the scratch DB
-- (checked immediately before this migration was drafted) and the
-- repository's own migration/seed history (no INSERT into this table
-- anywhere) — see the M3.1 Phase B report's PRE-MIGRATION ROW COUNTS.
-- Prisma's diff engine represents the unit -> uomCode change as a genuine
-- DROP COLUMN "unit" + ADD COLUMN "uomCode" (not an in-place rename/cast) —
-- reported explicitly per the M3.1 Phase B prompt's Migration Review Gate,
-- safe only because the column being dropped is confirmed empty.
ALTER TABLE "purchase_request_items" DROP COLUMN "unit",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "productId" TEXT,
ADD COLUMN     "requiredDate" TIMESTAMP(3),
ADD COLUMN     "skuSnapshot" TEXT,
ADD COLUMN     "uomCode" "UomCode" NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
-- Same DROP-then-ADD shape for priority (String -> PurchaseRequestPriority
-- enum) — likewise safe only because purchase_requests is confirmed empty
-- (the legacy lowercase default 'normal' never has to survive a cast,
-- because there is no existing row carrying it).
ALTER TABLE "purchase_requests" ADD COLUMN     "assignedBuyerUserId" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledByUserId" TEXT,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "payloadHash" TEXT,
DROP COLUMN "priority",
ADD COLUMN     "priority" "PurchaseRequestPriority" NOT NULL DEFAULT 'NORMAL';

-- CreateTable
CREATE TABLE "entity_sequences" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sequenceType" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "entity_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "entity_sequences_organizationId_sequenceType_year_key" ON "entity_sequences"("organizationId", "sequenceType", "year");

-- CreateIndex
CREATE INDEX "purchase_requests_organizationId_requesterId_idx" ON "purchase_requests"("organizationId", "requesterId");

-- CreateIndex
CREATE INDEX "purchase_requests_organizationId_assignedBuyerUserId_idx" ON "purchase_requests"("organizationId", "assignedBuyerUserId");

-- AddForeignKey
ALTER TABLE "entity_sequences" ADD CONSTRAINT "entity_sequences_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_assignedBuyerUserId_fkey" FOREIGN KEY ("assignedBuyerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Manual additions (Prisma has no declarative CHECK/partial-index syntax as
-- of this schema version — same precedent as every prior M2.x/M2.5
-- migration's own hand-appended constraints).

-- Architecture Gate Revision 1, Decision 8/11: a PR line always requests a
-- positive quantity — DB-enforced, not left to Zod validation alone.
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_quantity_positive" CHECK ("quantity" > 0);

-- Decision 11: year/lastValue sanity backstops for the sequence counter.
-- Formatting the human-readable PR number itself is explicitly a future
-- service-layer concern, not enforced here.
ALTER TABLE "entity_sequences" ADD CONSTRAINT "entity_sequences_year_positive" CHECK ("year" > 0);
ALTER TABLE "entity_sequences" ADD CONSTRAINT "entity_sequences_last_value_non_negative" CHECK ("lastValue" >= 0);

-- Decision 4/12: partial unique index — a NULL idempotencyKey never
-- collides with another NULL (ordinary creates are unaffected); two
-- non-NULL keys collide only within the same organization. Same shape as
-- stock_movements' own idempotency index (M2.5 migration).
CREATE UNIQUE INDEX "purchase_requests_organizationId_idempotencyKey_key" ON "purchase_requests"("organizationId", "idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;
