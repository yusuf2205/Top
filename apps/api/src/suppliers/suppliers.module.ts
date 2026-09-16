import { Module } from "@nestjs/common";
import { SuppliersController } from "./suppliers.controller";
import { SuppliersService } from "./suppliers.service";

/**
 * TENANT_PRISMA, AuditService, and EntitySequenceService are all `@Global()`
 * already — nothing to import here for those. No RealtimeModule import: M3.2
 * has no Supplier realtime (Architecture Gate Revision 1, Decision 13/D11 —
 * REST refresh is sufficient for low-frequency master-data edits).
 */
@Module({
  controllers: [SuppliersController],
  providers: [SuppliersService],
})
export class SuppliersModule {}
