-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('RECEIPT', 'ISSUE', 'TRANSFER', 'ADJUSTMENT', 'SCRAP', 'SPLIT');

-- CreateEnum
CREATE TYPE "StockMovementReferenceType" AS ENUM ('PURCHASE_ORDER', 'MANUAL', 'STOCK_MOVEMENT');

-- CreateEnum
CREATE TYPE "StockMovementLineEffect" AS ENUM ('INBOUND', 'OUTBOUND', 'TRANSFER', 'NONE');

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "referenceType" "StockMovementReferenceType",
    "referenceId" TEXT,
    "idempotencyKey" TEXT,
    "payloadHash" TEXT,
    "actorUserId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movement_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "movementId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "effect" "StockMovementLineEffect" NOT NULL,
    "sourcePieceId" TEXT,
    "destPieceId" TEXT,
    "sourceLotId" TEXT,
    "destLotId" TEXT,
    "sourceWarehouseId" TEXT,
    "sourceLocationId" TEXT,
    "destWarehouseId" TEXT,
    "destLocationId" TEXT,
    "uomCode" "UomCode" NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "baseQuantity" DECIMAL(18,3),

    CONSTRAINT "stock_movement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_movements_organizationId_createdAt_idx" ON "stock_movements"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "stock_movements_organizationId_type_idx" ON "stock_movements"("organizationId", "type");

-- CreateIndex
CREATE INDEX "stock_movements_organizationId_referenceType_referenceId_idx" ON "stock_movements"("organizationId", "referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "stock_movement_lines_organizationId_movementId_idx" ON "stock_movement_lines"("organizationId", "movementId");

-- CreateIndex
CREATE INDEX "stock_movement_lines_organizationId_productId_idx" ON "stock_movement_lines"("organizationId", "productId");

-- CreateIndex
CREATE INDEX "stock_movement_lines_organizationId_sourcePieceId_idx" ON "stock_movement_lines"("organizationId", "sourcePieceId");

-- CreateIndex
CREATE INDEX "stock_movement_lines_organizationId_destPieceId_idx" ON "stock_movement_lines"("organizationId", "destPieceId");

-- CreateIndex
CREATE INDEX "stock_movement_lines_organizationId_sourceLotId_idx" ON "stock_movement_lines"("organizationId", "sourceLotId");

-- CreateIndex
CREATE INDEX "stock_movement_lines_organizationId_destLotId_idx" ON "stock_movement_lines"("organizationId", "destLotId");

-- CreateIndex
CREATE INDEX "stock_movement_lines_organizationId_sourceWarehouseId_idx" ON "stock_movement_lines"("organizationId", "sourceWarehouseId");

-- CreateIndex
CREATE INDEX "stock_movement_lines_organizationId_destWarehouseId_idx" ON "stock_movement_lines"("organizationId", "destWarehouseId");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement_lines" ADD CONSTRAINT "stock_movement_lines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement_lines" ADD CONSTRAINT "stock_movement_lines_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "stock_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement_lines" ADD CONSTRAINT "stock_movement_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement_lines" ADD CONSTRAINT "stock_movement_lines_sourcePieceId_fkey" FOREIGN KEY ("sourcePieceId") REFERENCES "stock_pieces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement_lines" ADD CONSTRAINT "stock_movement_lines_destPieceId_fkey" FOREIGN KEY ("destPieceId") REFERENCES "stock_pieces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement_lines" ADD CONSTRAINT "stock_movement_lines_sourceLotId_fkey" FOREIGN KEY ("sourceLotId") REFERENCES "stock_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement_lines" ADD CONSTRAINT "stock_movement_lines_destLotId_fkey" FOREIGN KEY ("destLotId") REFERENCES "stock_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement_lines" ADD CONSTRAINT "stock_movement_lines_sourceWarehouseId_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement_lines" ADD CONSTRAINT "stock_movement_lines_sourceLocationId_fkey" FOREIGN KEY ("sourceLocationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement_lines" ADD CONSTRAINT "stock_movement_lines_destWarehouseId_fkey" FOREIGN KEY ("destWarehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement_lines" ADD CONSTRAINT "stock_movement_lines_destLocationId_fkey" FOREIGN KEY ("destLocationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Manual addition (Prisma has no declarative CHECK/partial-index syntax as
-- of this schema version — same pattern as StockBalance/StockLotPlacement/
-- StockPiece). Positive physical quantity, unconditional for every line
-- regardless of effect.
ALTER TABLE "stock_movement_lines" ADD CONSTRAINT "stock_movement_lines_quantity_positive" CHECK ("quantity" > 0);

-- Manual addition: ties baseQuantity's nullability directly to `effect` at
-- the database level (Architecture Gate Revision 2, "SPLIT / baseQuantity /
-- UOM SEMANTICS"). SPLIT lines (effect = 'NONE') never compute or store a
-- base-UOM quantity — UomConversionsService.convert() is never called for
-- them, so a SPLIT must succeed even when no confirmed conversion exists
-- for the piece's UOM. Every other effect (INBOUND/OUTBOUND/TRANSFER)
-- requires a positive baseQuantity, computed via the existing conversion
-- authority and frozen at write time.
ALTER TABLE "stock_movement_lines" ADD CONSTRAINT "stock_movement_lines_base_quantity_matches_effect" CHECK (
  ("effect" = 'NONE' AND "baseQuantity" IS NULL)
  OR
  ("effect" != 'NONE' AND "baseQuantity" IS NOT NULL AND "baseQuantity" > 0)
);

-- Manual addition: partial unique index for the idempotency algorithm
-- (Architecture Gate Revision 1/2, Idempotency section) — same Postgres
-- NULL-distinctness pattern as every prior hand-added partial index in this
-- project (StockBalance, StockLotPlacement): a plain composite unique would
-- treat every NULL idempotencyKey as distinct, defeating uniqueness for the
-- one case that matters (two rows sharing the same real key within an
-- organization). Requests with no idempotencyKey are simply excluded.
CREATE UNIQUE INDEX "stock_movements_organizationId_idempotencyKey_key" ON "stock_movements"("organizationId", "idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;
