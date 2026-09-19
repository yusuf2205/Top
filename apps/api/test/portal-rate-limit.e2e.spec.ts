import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp } from "./test-app";

/**
 * M3.4 Supplier Portal Phase C — rate limiting (Architecture §8/§25-26,
 * §62). Isolated in its own file/app instance so its deliberately-over-limit
 * request bursts never interfere with any other test's own throttle budget.
 * The throttle counts every request reaching ThrottlerGuard regardless of
 * auth outcome — a garbage/missing token is enough to prove the limit fires,
 * since ThrottlerGuard runs BEFORE PortalAuthGuard (Phase B's own
 * portal-guard-order.spec.ts already proves this at the framework level;
 * this test proves it against the REAL portal routes).
 */

describe("M3.4 Supplier Portal — rate limiting", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("OPEN: the 11th request within the window is 429, even with an invalid token — invalid-token requests still count toward the throttle", async () => {
    const results: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await request(app.getHttpServer()).post("/api/v1/portal/rfq/open").set("Authorization", "Bearer garbage-token-never-valid");
      results.push(res.status);
    }
    expect(results.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(results[10]).toBe(429);
  });
});
