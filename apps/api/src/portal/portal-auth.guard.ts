import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { createSystemPrismaClient } from "@top/database";
import { SYSTEM_PRISMA } from "../database/database.module";
import { TokenService } from "../common/token/token.service";
import type { AuthenticatedRequest } from "../common/types/authenticated-request";

/**
 * M3.4 Supplier Portal Phase B (Architecture Gate §28-29/§33-34, Revision 1
 * §6). Authentication ONLY — never mutates RFQSupplier.status, never writes
 * viewedAt, never audits, never touches Quote logic (those are Phase C
 * business-endpoint concerns, applied under this guard's resolved context
 * plus a fresh under-lock revalidation per Revision 1 §7).
 *
 * Pre-tenant by definition (the caller's organization isn't known until the
 * token itself resolves it) — SYSTEM_PRISMA is used ONLY for this one
 * `portalTokenHash` lookup, exactly the same justification already
 * documented for refresh-token/invitation-token lookups
 * (database.module.ts's own doc comment). No other portal business logic
 * may expand this SYSTEM_PRISMA usage (Revision 1 §33/Architecture §33).
 *
 * Every failure path (missing header, wrong scheme, empty bearer, unknown
 * token, expired token) returns the SAME generic 401 message — never
 * revealing which specific reason caused it (§34), so an attacker probing
 * the endpoint learns nothing about token validity/expiry/existence from the
 * response shape.
 */
const GENERIC_UNAUTHORIZED = "Invalid or expired portal credential";

@Injectable()
export class PortalAuthGuard implements CanActivate {
  constructor(
    @Inject(SYSTEM_PRISMA) private readonly systemDb: ReturnType<typeof createSystemPrismaClient>,
    private readonly tokens: TokenService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const raw = extractBearerToken(request.headers.authorization);
    if (!raw) {
      throw new UnauthorizedException(GENERIC_UNAUTHORIZED);
    }

    const tokenHash = this.tokens.hashToken(raw);

    // Bounded select (Architecture §29) — only what the auth context itself
    // requires. No Quote, no RFQItem[], no Supplier contacts/bank fields, no
    // other RFQSuppliers — this is a unique-indexed point lookup, never a
    // table scan.
    const rfqSupplier = await this.systemDb.rFQSupplier.findUnique({
      where: { portalTokenHash: tokenHash },
      select: {
        id: true,
        rfqId: true,
        supplierId: true,
        tokenExpiresAt: true,
        rfq: { select: { organizationId: true } },
      },
    });

    if (!rfqSupplier || !rfqSupplier.tokenExpiresAt || rfqSupplier.tokenExpiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException(GENERIC_UNAUTHORIZED);
    }

    request.portalContext = {
      organizationId: rfqSupplier.rfq.organizationId,
      rfqId: rfqSupplier.rfqId,
      rfqSupplierId: rfqSupplier.id,
      supplierId: rfqSupplier.supplierId,
      tokenHash,
    };

    return true;
  }
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  return scheme === "Bearer" && value ? value : null;
}
