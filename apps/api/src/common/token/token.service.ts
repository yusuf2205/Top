import { randomBytes, createHash } from "node:crypto";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { loadEnv } from "@top/config";
import type { UserRole } from "@top/database";
import type { AccessTokenClaims } from "../types/authenticated-request";

/**
 * Access tokens: short-lived JWT (JWT_ACCESS_TTL, default 15m), returned in the
 * response body and kept in memory by the frontend (never localStorage — see
 * apps/web auth context). Verified purely by signature + expiry; the claims it
 * carries (organizationId, role) are trusted for the token's lifetime, same as
 * any standard JWT session — see the guards for why this is not "trusting the
 * client" (the client never supplies these values, only the server-signed token).
 *
 * Refresh tokens: opaque random strings, never JWTs. Only their SHA-256 hash is
 * ever persisted (see RefreshToken model) — a stolen database dump can't be
 * replayed as a live session. Delivered to the browser as an httpOnly cookie
 * scoped to the API's own origin only.
 */
@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  signAccessToken(user: { id: string; organizationId: string; role: UserRole; email: string }): string {
    const env = loadEnv();
    const payload: AccessTokenClaims = {
      sub: user.id,
      organizationId: user.organizationId,
      role: user.role,
      email: user.email,
    };
    return this.jwt.sign(payload, {
      secret: env.JWT_ACCESS_SECRET,
      expiresIn: env.JWT_ACCESS_TTL,
      algorithm: "HS256",
    });
  }

  verifyAccessToken(token: string): AccessTokenClaims {
    const env = loadEnv();
    try {
      // M1.1 audit: explicitly pin the allowed algorithm rather than relying
      // on jsonwebtoken's default inference (which is HMAC-only for a plain
      // string secret and does already reject "alg: none"/RS256-confusion —
      // but an explicit allow-list is cheap, local, and doesn't depend on that
      // library-default behavior staying the same across versions).
      return this.jwt.verify<AccessTokenClaims>(token, {
        secret: env.JWT_ACCESS_SECRET,
        algorithms: ["HS256"],
      });
    } catch {
      throw new UnauthorizedException("Invalid or expired access token");
    }
  }

  /** Raw value goes to the client (cookie); only the hash is ever stored. */
  generateRefreshToken(): { raw: string; hash: string; expiresAt: Date } {
    const raw = randomBytes(48).toString("hex");
    const env = loadEnv();
    return { raw, hash: this.hashToken(raw), expiresAt: addDuration(new Date(), env.JWT_REFRESH_TTL) };
  }

  hashToken(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
  }

  /** Same hashing scheme as refresh tokens — used for invitation tokens too. */
  generateOpaqueToken(): { raw: string; hash: string } {
    const raw = randomBytes(32).toString("hex");
    return { raw, hash: this.hashToken(raw) };
  }
}

/** Parses simple durations like "15m", "7d", "12h" — same format JWT_*_TTL already uses. */
function addDuration(base: Date, duration: string): Date {
  const match = /^(\d+)([smhd])$/.exec(duration.trim());
  if (!match) throw new Error(`Invalid duration format: "${duration}" (expected e.g. "15m", "7d")`);
  const value = Number(match[1]);
  const unit = match[2] as "s" | "m" | "h" | "d";
  const unitMs: Record<"s" | "m" | "h" | "d", number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return new Date(base.getTime() + value * unitMs[unit]);
}
