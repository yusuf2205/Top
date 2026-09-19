import { Module } from "@nestjs/common";
import { PortalController } from "./portal.controller";
import { PortalService } from "./portal.service";
import { PortalAuthGuard } from "./portal-auth.guard";

/**
 * M3.4 Supplier Portal Phase C (Architecture §6). TENANT_PRISMA/SYSTEM_PRISMA
 * (DatabaseModule), TokenService (TokenModule), AuditService (AuditModule),
 * and ThrottlerModule are all `@Global()`/imported once in AppModule —
 * nothing to import here for those. `PortalAuthGuard` is a provider here
 * (not global) since it is only ever applied via this controller's own
 * route-level `@UseGuards()`.
 */
@Module({
  controllers: [PortalController],
  providers: [PortalService, PortalAuthGuard],
})
export class PortalModule {}
