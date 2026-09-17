import { Module } from "@nestjs/common";
import { RfqsController } from "./rfqs.controller";
import { RfqsService } from "./rfqs.service";

/**
 * M3.3 Phase C. TENANT_PRISMA, AuditService, and EntitySequenceService are
 * all `@Global()` already — nothing to import here for those. No
 * RealtimeModule import (Architecture Revision 1: RFQ realtime is explicitly
 * NO — see rfqs.service.ts, which never injects DomainEventsService).
 */
@Module({
  controllers: [RfqsController],
  providers: [RfqsService],
})
export class RfqsModule {}
