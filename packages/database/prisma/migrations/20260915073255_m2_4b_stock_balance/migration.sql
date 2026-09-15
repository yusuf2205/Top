-- CreateTable
CREATE TABLE "stock_balances" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "locationId" TEXT,
    "uomCode" "UomCode" NOT NULL,
    "onHandQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "reservedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_balances_organizationId_productId_idx" ON "stock_balances"("organizationId", "productId");

-- CreateIndex
CREATE INDEX "stock_balances_organizationId_warehouseId_idx" ON "stock_balances"("organizationId", "warehouseId");

-- CreateIndex
CREATE INDEX "stock_balances_organizationId_locationId_idx" ON "stock_balances"("organizationId", "locationId");

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Manual additions (Prisma has no declarative syntax for partial unique
-- indexes or CHECK constraints as of this schema version — see the
-- StockBalance doc comment in schema.prisma). Postgres treats NULL as
-- distinct from itself, so a single composite unique index on
-- (productId, warehouseId, locationId) would silently allow multiple
-- warehouse-level (locationId IS NULL) rows for the same product+warehouse
-- — these two partial indexes close that gap for both cases.
CREATE UNIQUE INDEX "stock_balances_product_warehouse_location_key"
  ON "stock_balances"("productId", "warehouseId", "locationId")
  WHERE "locationId" IS NOT NULL;

CREATE UNIQUE INDEX "stock_balances_product_warehouse_null_location_key"
  ON "stock_balances"("productId", "warehouseId")
  WHERE "locationId" IS NULL;

-- Defense-in-depth: the service layer already rejects negative quantities
-- (zod's decimalString) and reservedQty > onHandQty (explicit Decimal
-- comparison) before ever reaching the database — these CHECK constraints
-- are the final backstop against any future code path that bypasses the
-- service (a raw fix-up script, a bug in a later slice), not the primary
-- enforcement mechanism.
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_on_hand_qty_non_negative" CHECK ("onHandQty" >= 0);
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_reserved_qty_non_negative" CHECK ("reservedQty" >= 0);
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_reserved_not_exceed_on_hand" CHECK ("reservedQty" <= "onHandQty");

