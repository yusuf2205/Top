-- CreateTable
CREATE TABLE "stock_lots" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "supplierId" TEXT,
    "lotNumber" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_lot_placements" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "stockLotId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "locationId" TEXT,
    "uomCode" "UomCode" NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_lot_placements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_lots_organizationId_productId_idx" ON "stock_lots"("organizationId", "productId");

-- CreateIndex
CREATE INDEX "stock_lots_organizationId_productId_lotNumber_idx" ON "stock_lots"("organizationId", "productId", "lotNumber");

-- CreateIndex
CREATE INDEX "stock_lots_organizationId_supplierId_idx" ON "stock_lots"("organizationId", "supplierId");

-- CreateIndex
CREATE INDEX "stock_lot_placements_organizationId_stockLotId_idx" ON "stock_lot_placements"("organizationId", "stockLotId");

-- CreateIndex
CREATE INDEX "stock_lot_placements_organizationId_productId_warehouseId_l_idx" ON "stock_lot_placements"("organizationId", "productId", "warehouseId", "locationId");

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lot_placements" ADD CONSTRAINT "stock_lot_placements_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lot_placements" ADD CONSTRAINT "stock_lot_placements_stockLotId_fkey" FOREIGN KEY ("stockLotId") REFERENCES "stock_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lot_placements" ADD CONSTRAINT "stock_lot_placements_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lot_placements" ADD CONSTRAINT "stock_lot_placements_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lot_placements" ADD CONSTRAINT "stock_lot_placements_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Manual additions (Prisma has no declarative syntax for partial unique
-- indexes or CHECK constraints as of this schema version — see the
-- StockLotPlacement doc comment in schema.prisma). Same NULL-distinctness
-- problem, and same fix, as StockBalance in M2.4-B: a single composite
-- unique on (stockLotId, warehouseId, locationId) would silently allow
-- duplicate warehouse-level (locationId IS NULL) placement rows for the
-- same lot+warehouse, since Postgres treats NULL as distinct from itself.
CREATE UNIQUE INDEX "stock_lot_placements_lot_warehouse_location_key"
  ON "stock_lot_placements"("stockLotId", "warehouseId", "locationId")
  WHERE "locationId" IS NOT NULL;

CREATE UNIQUE INDEX "stock_lot_placements_lot_warehouse_null_location_key"
  ON "stock_lot_placements"("stockLotId", "warehouseId")
  WHERE "locationId" IS NULL;

-- Note: deliberately NO uniqueness constraint anywhere on stock_lots.lotNumber
-- (or any combination with productId/supplierId) — see StockLot's doc
-- comment in schema.prisma: external lot numbers are provenance metadata,
-- not identity, and are not guaranteed unique even within one supplier.
ALTER TABLE "stock_lot_placements" ADD CONSTRAINT "stock_lot_placements_quantity_non_negative" CHECK ("quantity" >= 0);

