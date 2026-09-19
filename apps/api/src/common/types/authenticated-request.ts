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

/**
 * M3.4 Supplier Portal Phase B (Architecture Revision 1 §6/§26-27, locked).
 * Attached by PortalAuthGuard after resolving a bearer portal token —
 * deliberately NOT `AccessTokenClaims`/`request.user`: there is no internal
 * User, no UserRole.SUPPLIER session, nothing "fake" here (§79 security
 * principles). `tokenHash` is carried so a later business mutation can
 * revalidate the credential under a row lock (Revision 1 §7) without ever
 * needing the raw token again. The raw token itself is NEVER attached here.
 */
export interface PortalContext {
  organizationId: string;
  rfqId: string;
  rfqSupplierId: string;
  supplierId: string;
  tokenHash: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AccessTokenClaims;
  portalContext?: PortalContext;
}
