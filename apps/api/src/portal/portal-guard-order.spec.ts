process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.S3_ENDPOINT ??= "http://localhost:9000";
process.env.S3_ACCESS_KEY ??= "test";
process.env.S3_SECRET_KEY ??= "test";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-at-least-32-characters-long";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-at-least-32-characters-long";
process.env.PORTAL_TOKEN_SECRET ??= "test-portal-secret-at-least-32-characters-long";

import { Controller, Get, INestApplication, Module, UseGuards } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ThrottlerGuard, ThrottlerModule, Throttle } from "@nestjs/throttler";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { Public } from "../common/decorators/public.decorator";
import { TokenService } from "../common/token/token.service";
import { SYSTEM_PRISMA } from "../database/database.module";
import { PortalAuthGuard } from "./portal-auth.guard";

/**
 * M3.4 Supplier Portal Phase B (Architecture §39/§26, Revision 1 §26).
 * Proves — against the REAL PortalAuthGuard and REAL ThrottlerGuard, not a
 * stand-in — that the intended future controller wiring
 * `@UseGuards(ThrottlerGuard, PortalAuthGuard)` runs ThrottlerGuard FIRST,
 * so a request is rate-limited even when its bearer token is invalid/absent
 * (i.e. an attacker cannot bypass the throttle merely by sending garbage
 * tokens). No production endpoint is added — this controller exists only
 * inside this spec file (§39/§43).
 */
@Public()
@Controller("test-only-portal-guard-order-probe")
class GuardOrderProbeController {
  @UseGuards(ThrottlerGuard, PortalAuthGuard)
  @Throttle({ "guard-order-test": { limit: 2, ttl: 60_000 } })
  @Get()
  probe() {
    return { ok: true };
  }
}

@Module({
  imports: [JwtModule.register({}), ThrottlerModule.forRoot([{ name: "guard-order-test", ttl: 60_000, limit: 2 }])],
  controllers: [GuardOrderProbeController],
  providers: [
    TokenService,
    // SYSTEM_PRISMA stands in for the real client — every request here has
    // no Authorization header at all, so PortalAuthGuard rejects before this
    // is ever queried; it exists only to satisfy PortalAuthGuard's DI.
    { provide: SYSTEM_PRISMA, useValue: { rFQSupplier: { findUnique: async () => null } } },
  ],
})
class GuardOrderProbeModule {}

describe("Future portal controller guard order — ThrottlerGuard before PortalAuthGuard (Architecture §26/§39)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [GuardOrderProbeModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects requests 1-2 with 401 (PortalAuthGuard, no token) and request 3 with 429 (ThrottlerGuard) — proving the throttle counts invalid-token requests and fires before auth", async () => {
    const first = await request(app.getHttpServer()).get("/test-only-portal-guard-order-probe");
    const second = await request(app.getHttpServer()).get("/test-only-portal-guard-order-probe");
    const third = await request(app.getHttpServer()).get("/test-only-portal-guard-order-probe");

    expect(first.status).toBe(401);
    expect(second.status).toBe(401);
    // If PortalAuthGuard ran before ThrottlerGuard, this would also be 401
    // (no token was ever sent) — 429 instead proves ThrottlerGuard blocked
    // the request before PortalAuthGuard ever ran.
    expect(third.status).toBe(429);
  });
});
