import { Module } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module";
import { PurchaseRequestsController } from "./purchase-requests.controller";
import { PurchaseRequestsService } from "./purchase-requests.service";

/**
 * TENANT_PRISMA, AuditService, and EntitySequenceService are all `@Global()`
 * already — nothing to import here for those. RealtimeModule (M3.1 Phase F)
 * is NOT global (same as StockModule/ProductsModule's own imports) — the
 * service injects DomainEventsService to publish post-commit workflow
 * events; this module never touches the gateway or auth service directly.
 */
@Module({
  imports: [RealtimeModule],
  controllers: [PurchaseRequestsController],
  providers: [PurchaseRequestsService],
})
export class PurchaseRequestsModule {}
