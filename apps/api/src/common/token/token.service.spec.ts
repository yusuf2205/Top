import { JwtService } from "@nestjs/jwt";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.S3_ENDPOINT ??= "http://localhost:9000";
process.env.S3_ACCESS_KEY ??= "test";
process.env.S3_SECRET_KEY ??= "test";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-at-least-32-characters-long";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-at-least-32-characters-long";
process.env.PORTAL_TOKEN_SECRET ??= "test-portal-secret-at-least-32-characters-long";

// Imported after env vars are set — loadEnv() is called lazily inside
// TokenService's methods, but importing early is still safest.
import { TokenService } from "./token.service";

describe("TokenService", () => {
  const service = new TokenService(new JwtService({}));

  it("signs an access token carrying the expected claims and verifies it back", () => {
    const token = service.signAccessToken({
      id: "user-1",
      organizationId: "org-1",
      role: "ADMIN",
      email: "a@example.com",
    });
    const claims = service.verifyAccessToken(token);
    expect(claims).toMatchObject({
      sub: "user-1",
      organizationId: "org-1",
      role: "ADMIN",
      email: "a@example.com",
    });
  });

  it("rejects a tampered/invalid access token", () => {
    expect(() => service.verifyAccessToken("not-a-real-token")).toThrow();
  });

  it("generates a refresh token whose raw value is never equal to its hash", () => {
    const { raw, hash } = service.generateRefreshToken();
    expect(raw).not.toEqual(hash);
    expect(hash).toHaveLength(64); // sha256 hex
  });

  it("hashes the same raw token deterministically (needed for lookup-by-hash)", () => {
    const { raw } = service.generateRefreshToken();
    expect(service.hashToken(raw)).toEqual(service.hashToken(raw));
  });

  it("generates unique opaque tokens across calls", () => {
    const a = service.generateOpaqueToken();
    const b = service.generateOpaqueToken();
    expect(a.raw).not.toEqual(b.raw);
  });
});
