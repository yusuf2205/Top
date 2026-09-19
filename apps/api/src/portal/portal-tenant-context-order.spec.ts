process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.S3_ENDPOINT ??= "http://localhost:9000";
process.env.S3_ACCESS_KEY ??= "test";
process.env.S3_SECRET_KEY ??= "test";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-at-least-32-characters-long";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-at-least-32-characters-long";
process.env.PORTAL_TOKEN_SECRET ??= "test-portal-secret-at-least-32-characters-long";

import { CanActivate, Controller, ExecutionContext, Get, INestApplication, Injectable, Module, UseGuards } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { TenantGuard } from "../common/guards/tenant.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { TenantContextInterceptor } from "../common/interceptors/tenant-context.interceptor";
import { Public } from "../common/decorators/public.decorator";
import { TokenService } from "../common/token/token.service";
import { getTenantContextOrNull } from "@top/database";
import type { AuthenticatedRequest } from "../common/types/authenticated-request";

/**
 * M3.4 Supplier Portal Phase B — Architecture Revision 1 §31/§32 demanded
 * empirical proof (not an assumption) that a CONTROLLER-LEVEL guard's
 * request mutation is visible to the GLOBAL TenantContextInterceptor before
 * the route handler runs. This spec builds the real global guard/interceptor
 * chain from apps/api/src/app.module.ts (same classes, same registration
 * order) around a throwaway test-only controller — never registered in the
 * real AppModule, never a production endpoint (§39) — and fires a real HTTP
 * request through the full Nest pipeline via supertest, proving the
 * lifecycle empirically rather than asserting it from documentation alone.
 */
@Injectable()
class FakePortalAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    req.portalContext = {
      organizationId: "portal-org-1",
      rfqId: "rfq-1",
      rfqSupplierId: "rfq-supplier-1",
      supplierId: "supplier-1",
      tokenHash: "irrelevant-for-this-test",
    };
    return true;
  }
}

@Public()
@Controller("test-only-portal-order-probe")
class ProbeController {
  @UseGuards(FakePortalAuthGuard)
  @Get()
  probe() {
    return { observedOrganizationId: getTenantContextOrNull()?.organizationId ?? null };
  }
}

@Module({
  imports: [JwtModule.register({})],
  controllers: [ProbeController],
  providers: [
    TokenService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
class ProbeModule {}

describe("TenantContextInterceptor execution order vs a controller-level guard (Revision 1 §31/§32 empirical proof)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("sees portalContext.organizationId inside the route handler, proving the guards phase (global + controller-level) fully completes before the global interceptor runs", async () => {
    const res = await request(app.getHttpServer()).get("/test-only-portal-order-probe").expect(200);
    expect(res.body).toEqual({ observedOrganizationId: "portal-org-1" });
  });
});
