import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Socket } from "socket.io";
import type { createSystemPrismaClient } from "@top/database";
import { SYSTEM_PRISMA } from "../database/database.module";
import { TokenService } from "../common/token/token.service";
import type { AccessTokenClaims } from "../common/types/authenticated-request";

type SystemDb = ReturnType<typeof createSystemPrismaClient>;

/**
 * Realtime Foundation — socket handshake authentication. Reuses the exact
 * same JWT verification as HTTP (TokenService.verifyAccessToken: signature +
 * expiry, HS256 only) — no second auth system, no separate token type.
 *
 * One deliberate difference from plain HTTP JwtAuthGuard: this ALSO does a
 * live `User.active` check via SYSTEM_PRISMA. HTTP JwtAuthGuard trusts the
 * JWT's claims for the token's whole (short, ~15m) lifetime without a DB
 * round trip — acceptable there because each HTTP request is one-shot. A
 * socket connection is long-lived (hours), so "disabled mid-session" is a
 * real, testable scenario here in a way it practically isn't for a single
 * HTTP call; hence the extra check at connect time only (not on every
 * subsequent message — this foundation has no client-to-server messages to
 * re-check on anyway).
 *
 * SYSTEM_PRISMA use here is a deliberate, documented extension of
 * database.module.ts's "only pre-tenant identity operations" allow-list —
 * see that file's own updated doc comment. This runs before any tenant
 * context exists, exactly like login/refresh.
 */
@Injectable()
export class SocketAuthService {
  constructor(
    @Inject(SYSTEM_PRISMA) private readonly db: SystemDb,
    private readonly tokens: TokenService
  ) {}

  async authenticate(client: Socket): Promise<AccessTokenClaims> {
    const token = extractToken(client);
    if (!token) {
      throw new UnauthorizedException("Missing access token");
    }

    // Throws UnauthorizedException on a missing/malformed/invalid-signature/
    // expired token — same TokenService, same error, as HTTP.
    const claims = this.tokens.verifyAccessToken(token);

    const user = await this.db.user.findFirst({ where: { id: claims.sub, organizationId: claims.organizationId } });
    if (!user || !user.active) {
      throw new UnauthorizedException("User is not eligible to connect");
    }

    return claims;
  }
}

/**
 * Prefers `handshake.auth.token` — the standard `io(url, { auth: { token } })`
 * client convention, avoiding cookies entirely for sockets (this foundation
 * authenticates by bearer token only, never the httpOnly refresh cookie).
 * Falls back to a plain `Authorization: Bearer <token>` handshake header for
 * any client that prefers that shape.
 */
function extractToken(client: Socket): string | null {
  const fromAuth = client.handshake.auth?.token as unknown;
  if (typeof fromAuth === "string" && fromAuth.length > 0) return fromAuth;

  const header = client.handshake.headers.authorization;
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  return scheme === "Bearer" && value ? value : null;
}
