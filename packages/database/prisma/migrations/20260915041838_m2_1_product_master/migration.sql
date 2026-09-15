-- M2.1: Product Master + Category. Purely additive — 3 new enums, 2 new tables, no existing table touched.
-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('GOODS', 'MATERIAL', 'RAW_MATERIAL', 'COMPONENT', 'CONSUMABLE', 'SERVICE');

-- CreateEnum
CREATE TYPE "ProductTrackingMode" AS ENUM ('QUANTITY', 'LOT', 'PIECE');

-- CreateEnum
CREATE TYPE "UomCode" AS ENUM ('PCS', 'KG', 'G', 'TON', 'M', 'CM', 'MM', 'M2', 'M3', 'L', 'ML');

-- CreateTable
CREATE TABLE "product_categories" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "productType" "ProductType" NOT NULL,
    "categoryId" TEXT,
    "brand" TEXT,
    "manufacturer" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "baseUomCode" "UomCode" NOT NULL,
    "trackingMode" "ProductTrackingMode" NOT NULL DEFAULT 'QUANTITY',
    "stockTracked" BOOLEAN NOT NULL DEFAULT true,
    "weightNetKg" DECIMAL(18,3),
    "weightGrossKg" DECIMAL(18,3),
    "barcode" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_categories_organizationId_parentId_idx" ON "product_categories"("organizationId", "parentId");

-- CreateIndex
CREATE INDEX "products_organizationId_active_idx" ON "products"("organizationId", "active");

-- CreateIndex
CREATE INDEX "products_organizationId_categoryId_idx" ON "products"("organizationId", "categoryId");

-- CreateIndex
CREATE INDEX "products_organizationId_productType_idx" ON "products"("organizationId", "productType");

-- CreateIndex
CREATE UNIQUE INDEX "products_organizationId_sku_key" ON "products"("organizationId", "sku");

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

