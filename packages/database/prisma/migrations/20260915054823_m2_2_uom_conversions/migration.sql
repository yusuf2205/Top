-- M2.2: UOM conversions. Purely additive — 1 new enum, 1 new table, no existing table touched.
-- CreateEnum
CREATE TYPE "ConversionSource" AS ENUM ('CONFIGURED', 'MEASURED', 'NOT_AVAILABLE');

-- CreateTable
CREATE TABLE "uom_conversions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "uomCode" "UomCode" NOT NULL,
    "ratio" DECIMAL(18,6),
    "source" "ConversionSource" NOT NULL,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uom_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "uom_conversions_organizationId_productId_idx" ON "uom_conversions"("organizationId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "uom_conversions_productId_uomCode_key" ON "uom_conversions"("productId", "uomCode");

-- AddForeignKey
ALTER TABLE "uom_conversions" ADD CONSTRAINT "uom_conversions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uom_conversions" ADD CONSTRAINT "uom_conversions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Manual addition (M2.2 §11): Prisma has no declarative CHECK syntax in this
-- version. Enforces the source/ratio invariant at the DB layer as a backstop
-- to the application-level check (defense in depth, same pattern as the
-- planned stock_balances.onHandQty >= 0 constraint in M2-PRODUCT-STOCK-ARCHITECTURE.md).
ALTER TABLE "uom_conversions" ADD CONSTRAINT "uom_conversions_ratio_source_consistency" CHECK (
  ("source" = 'NOT_AVAILABLE' AND "ratio" IS NULL) OR
  ("source" != 'NOT_AVAILABLE' AND "ratio" > 0)
);
