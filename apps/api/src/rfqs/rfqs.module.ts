import { Module } from "@nestjs/common";
import { RfqsController } from "./rfqs.controller";
import { RfqsService } from "./rfqs.service";
import { RfqPortalAccessService } from "./rfq-portal-access.service";

/**
 * M3.3 Phase C. TENANT_PRISMA, AuditService, and EntitySequenceService are
 * all `@Global()` already — nothing to import here for those. No
 * RealtimeModule import (Architecture Revision 1: RFQ realtime is explicitly
 * NO — see rfqs.service.ts, which never injects DomainEventsService).
 *
 * M3.4 Phase C: `RfqPortalAccessService` (internal invite/reissue/revoke/
 * quote-read) is a small, focused sibling service (Architecture §5 Option
 * B) — exposed via nested routes on the SAME RfqsController, not a new
 * controller/module. TokenService (needed for invite/reissue) is `@Global()`
 * too — nothing to import for it either.
 */
@Module({
  controllers: [RfqsController],
  providers: [RfqsService, RfqPortalAccessService],
})
export class RfqsModule {}
