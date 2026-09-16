import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
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
    HealthModule,
    AuthModule,
    OrganizationsModule,
    MembersModule,
    ProductsModule,
    WarehousesModule,
    StockModule,
    RealtimeModule,
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
