-- CreateTable
CREATE TABLE "material_specifications" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "material" TEXT,
    "grade" TEXT,
    "standard" TEXT,
    "countryOfOrigin" TEXT,
    "widthMm" DECIMAL(18,3),
    "thicknessMm" DECIMAL(18,3),
    "lengthMm" DECIMAL(18,3),
    "heightMm" DECIMAL(18,3),
    "outerDiameterMm" DECIMAL(18,3),
    "innerDiameterMm" DECIMAL(18,3),
    "crossSectionMm2" DECIMAL(18,3),
    "densityKgM3" DECIMAL(18,3),
    "attributes" JSONB,
    "displayValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_specifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "material_specifications_productId_key" ON "material_specifications"("productId");

-- AddForeignKey
ALTER TABLE "material_specifications" ADD CONSTRAINT "material_specifications_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

