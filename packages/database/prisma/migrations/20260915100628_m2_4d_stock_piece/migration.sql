-- CreateEnum
CREATE TYPE "StockPieceStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'CONSUMED', 'SCRAPPED');

-- CreateTable
CREATE TABLE "stock_pieces" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "locationId" TEXT,
    "parentPieceId" TEXT,
    "quantity" DECIMAL(18,3) NOT NULL,
    "uomCode" "UomCode" NOT NULL,
    "status" "StockPieceStatus" NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_pieces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_pieces_organizationId_lotId_idx" ON "stock_pieces"("organizationId", "lotId");

-- CreateIndex
CREATE INDEX "stock_pieces_organizationId_productId_warehouseId_locationI_idx" ON "stock_pieces"("organizationId", "productId", "warehouseId", "locationId", "status");

-- CreateIndex
CREATE INDEX "stock_pieces_organizationId_parentPieceId_idx" ON "stock_pieces"("organizationId", "parentPieceId");

-- AddForeignKey
ALTER TABLE "stock_pieces" ADD CONSTRAINT "stock_pieces_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_pieces" ADD CONSTRAINT "stock_pieces_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_pieces" ADD CONSTRAINT "stock_pieces_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_pieces" ADD CONSTRAINT "stock_pieces_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_pieces" ADD CONSTRAINT "stock_pieces_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_pieces" ADD CONSTRAINT "stock_pieces_parentPieceId_fkey" FOREIGN KEY ("parentPieceId") REFERENCES "stock_pieces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Manual addition (Prisma has no declarative CHECK syntax as of this schema
-- version — same pattern as StockBalance/StockLotPlacement). Unconditional
-- for every status: a piece is a physical object and physical objects have
-- positive size — CONSUMED/SCRAPPED pieces (not reachable via M2.4-D's own
-- endpoints, since no transitions are implemented yet) freeze at their last
-- positive quantity rather than zeroing out, so this holds for every row.
ALTER TABLE "stock_pieces" ADD CONSTRAINT "stock_pieces_quantity_positive" CHECK ("quantity" > 0);

