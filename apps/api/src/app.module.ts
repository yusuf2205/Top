import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { HealthModule } from "./health/health.module";
import { DatabaseModule } from "./database/database.module";
import { TokenModule } from "./common/token/token.module";
import { AuditModule } from "./common/audit/audit.module";
import { EntitySequenceModule } from "./common/entity-sequence/entity-sequence.module";
import { AuthModule } from "./auth/auth.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { MembersModule } from "./members/members.module";
import { ProductsModule } from "./products/products.module";
import { WarehousesModule } from "./warehouses/warehouses.module";
import { StockModule } from "./stock/stock.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { PurchaseRequestsModule } from "./purchase-requests/purchase-requests.module";
import { SuppliersModule } from "./suppliers/suppliers.module";
import { CategoriesModule } from "./categories/categories.module";
import { RfqsModule } from "./rfqs/rfqs.module";
import { PortalModule } from "./portal/portal.module";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { TenantGuard } from "./common/guards/tenant.guard";
import { RolesGuard } from "./common/guards/roles.guard";
import { TenantContextInterceptor } from "./common/interceptors/tenant-context.interceptor";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";

/**
 * M1: Auth + Organization + RBAC. Guard order matters — NestJS runs APP_GUARD
 * providers in registration order: JwtAuthGuard (populates request.user from
 * a verified access token) -> TenantGuard (fails fast if organizationId is
 * missing) -> RolesGuard (per-endpoint @Roles() check). Interceptors run after
 * guards pass; TenantContextInterceptor is what actually threads the
 * AsyncLocalStorage tenant context through to Prisma (see its own doc comment).
 */
@Module({
  imports: [
    DatabaseModule,
    TokenModule,
    AuditModule,
    EntitySequenceModule,
    // M3.4 Supplier Portal Phase B (Architecture §36-38): in-memory storage
    // (no Redis — a single-API-instance deployment, per Revision 1 D35's
    // own reasoning), registered here ONLY so `ThrottlerGuard`/`@Throttle()`
    // are available for DI. Deliberately NOT registered as a global
    // APP_GUARD below — internal routes are completely unaffected; the
    // future Phase C portal controller applies `ThrottlerGuard` itself via
    // route-level `@UseGuards(ThrottlerGuard, PortalAuthGuard)` (order
    // matters — see PortalAuthGuard's own doc comment). The single "portal"
    // named throttler below is a generic 60/min-per-IP baseline; each of the
    // four portal routes (open/get/quote/decline) is intended to override it
    // per-route via `@Throttle({ portal: { limit, ttl } })` with the
    // specific limits Architecture Revision 1 §41 proposed (10/60/10/10 per
    // minute) — Phase C's real PortalController now applies exactly these
    // per-route overrides via `@Throttle({ portal: { limit, ttl } })`.
    ThrottlerModule.forRoot([{ name: "portal", ttl: 60_000, limit: 60 }]),
    HealthModule,
    AuthModule,
    OrganizationsModule,
    MembersModule,
    ProductsModule,
    WarehousesModule,
    StockModule,
    RealtimeModule,
    PurchaseRequestsModule,
    SuppliersModule,
    CategoriesModule,
    RfqsModule,
    PortalModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
