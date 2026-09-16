import { Module } from "@nestjs/common";
import { RealtimeGateway } from "./realtime.gateway";
import { SocketAuthService } from "./socket-auth.service";
import { DomainEventsService } from "./domain-events.service";

/**
 * Realtime Foundation. TokenService (TokenModule) and SYSTEM_PRISMA
 * (DatabaseModule) are both `@Global()` already — nothing to import here for
 * SocketAuthService's own dependencies. Only DomainEventsService is exported:
 * business modules (StockModule, ProductsModule, ...) inject it to publish
 * post-commit events; nothing outside this module ever needs the gateway or
 * the auth service directly.
 */
@Module({
  providers: [RealtimeGateway, SocketAuthService, DomainEventsService],
  exports: [DomainEventsService],
})
export class RealtimeModule {}
