import type { Request } from "express";
import type { UserRole } from "@top/database";

/**
 * Claims decoded from a verified access token — attached to the request by
 * JwtAuthGuard. Never sourced from request body/query: only from a
 * cryptographically verified JWT issued by this server (see TokenService).
 */
export interface AccessTokenClaims {
  sub: string; // userId
  organizationId: string;
  role: UserRole;
  email: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AccessTokenClaims;
}
