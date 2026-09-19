import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { createTenantSafePrismaClient } from "@top/database";
import type { PortalAccessIssuedView, QuoteView, RfqSupplierView } from "@top/types";
import { TENANT_PRISMA } from "../database/database.module";
import { AuditService } from "../common/audit/audit.service";
import { TokenService } from "../common/token/token.service";
import { toQuoteView } from "../portal/portal-serializers";
import { lockRfq, lockRfqSupplier } from "./rfq-locks";
import { toRfqSupplierView } from "./rfqs.service";

type TenantDb = ReturnType<typeof createTenantSafePrismaClient>;

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * M3.4 Supplier Portal Phase C (Architecture §5/§9-16) — a small, focused
 * service dedicated to internal portal-ACCESS-management (invite/reissue/
 * revoke) and the bounded internal Quote read, kept deliberately separate
 * from RfqsService (§5 Option B) rather than growing that already-large
 * file into an uncontrolled monolith. Exposed via nested routes on
 * RfqsController — no new microservice, no new controller.
 */
@Injectable()
export class RfqPortalAccessService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly tokens: TokenService
  ) {}

  // ────────────────────────────────────────────────────────────
  // INVITE (Architecture §9-11)
  // ────────────────────────────────────────────────────────────

  async invite(organizationId: string, actorUserId: string, rfqId: string, rfqSupplierId: string): Promise<PortalAccessIssuedView> {
    return this.db.$transaction(async (tx) => {
      const now = new Date();
      const rfq = await lockRfq(tx, organizationId, rfqId);
      this.requireSentWithFutureDeadline(rfq, now);

      const rfqSupplier = await lockRfqSupplier(tx, organizationId, rfqSupplierId);
      // Critical IDOR defense (§10): the locked row must belong to THIS route's rfqId — never assumed from the tenant-scoped lock alone.
      if (rfqSupplier.rfqId !== rfq.id) throw new NotFoundException("RFQ supplier not found");

      if (rfqSupplier.status !== "SELECTED") {
        throw new ConflictException(`Cannot invite — participation status is ${rfqSupplier.status}. Use reissue if a credential already exists.`);
      }
      if (rfqSupplier.portalTokenHash !== null) {
        throw new ConflictException("A portal credential already exists for this supplier — use reissue instead");
      }

      const { raw, hash } = this.tokens.generateOpaqueToken();
      const tokenExpiresAt = new Date(rfq.deadline!.getTime() + SEVEN_DAYS_MS);

      await tx.rFQSupplier.update({
        where: { id: rfqSupplier.id },
        data: { portalTokenHash: hash, tokenExpiresAt, invitedAt: now, status: "INVITED" },
      });

      await this.audit.log(
        {
          organizationId,
          userId: actorUserId,
          action: "RFQ_SUPPLIER_INVITED",
          entityType: "RFQSupplier",
          entityId: rfqSupplier.id,
          newValue: { rfqId: rfq.id, supplierId: rfqSupplier.supplierId, tokenExpiresAt: tokenExpiresAt.toISOString() },
        },
        tx
      );

      // Raw token exists only on this return path — never persisted, never audited, never logged (§47).
      return { token: raw };
    });
  }

  // ────────────────────────────────────────────────────────────
  // REISSUE (Architecture §12-13)
  // ────────────────────────────────────────────────────────────

  async reissue(organizationId: string, actorUserId: string, rfqId: string, rfqSupplierId: string): Promise<PortalAccessIssuedView> {
    return this.db.$transaction(async (tx) => {
      const now = new Date();
      const rfq = await lockRfq(tx, organizationId, rfqId);
      this.requireSentWithFutureDeadline(rfq, now);

      const rfqSupplier = await lockRfqSupplier(tx, organizationId, rfqSupplierId);
      if (rfqSupplier.rfqId !== rfq.id) throw new NotFoundException("RFQ supplier not found");

      if (rfqSupplier.status === "SELECTED" || rfqSupplier.status === "SUBMITTED" || rfqSupplier.status === "EXPIRED") {
        throw new ConflictException(`Cannot reissue — participation status is ${rfqSupplier.status}`);
      }
      // INVITED / VIEWED / DECLINED are all reissuable — DECLINED is the one sanctioned reactivation path (Revision 1 §14).

      const { raw, hash } = this.tokens.generateOpaqueToken();
      const tokenExpiresAt = new Date(rfq.deadline!.getTime() + SEVEN_DAYS_MS);

      // Atomic overwrite — the old hash stops matching the instant this
      // commits, so any old-token request's own under-lock revalidation
      // fails from that point on (Architecture §13/§66).
      await tx.rFQSupplier.update({
        where: { id: rfqSupplier.id },
        data: { portalTokenHash: hash, tokenExpiresAt, invitedAt: now, viewedAt: null, status: "INVITED" },
      });

      await this.audit.log(
        {
          organizationId,
          userId: actorUserId,
          action: "RFQ_SUPPLIER_PORTAL_REISSUED",
          entityType: "RFQSupplier",
          entityId: rfqSupplier.id,
          newValue: { rfqId: rfq.id, supplierId: rfqSupplier.supplierId, tokenExpiresAt: tokenExpiresAt.toISOString() },
        },
        tx
      );

      return { token: raw };
    });
  }

  // ────────────────────────────────────────────────────────────
  // REVOKE (Architecture §14-15)
  // ────────────────────────────────────────────────────────────

  /** Returns the updated, bounded RfqSupplierView (§15) — never a raw token/hash — so the caller (and its portalAccessActive metadata) reflects the post-revoke state directly. */
  async revoke(organizationId: string, actorUserId: string, rfqId: string, rfqSupplierId: string): Promise<RfqSupplierView> {
    return this.db.$transaction(async (tx) => {
      // No RFQ status/deadline requirement — revocation is a security
      // control, not an RFQ workflow mutation (§14). RFQ is still locked
      // first only to preserve the standard RFQ -> RFQSupplier lock order.
      const rfq = await lockRfq(tx, organizationId, rfqId);
      const rfqSupplier = await lockRfqSupplier(tx, organizationId, rfqSupplierId);
      if (rfqSupplier.rfqId !== rfq.id) throw new NotFoundException("RFQ supplier not found");

      if (rfqSupplier.portalTokenHash !== null) {
        // Never altered: status / invitedAt / viewedAt / Quote (no historical rewrite).
        await tx.rFQSupplier.update({ where: { id: rfqSupplier.id }, data: { portalTokenHash: null, tokenExpiresAt: null } });

        await this.audit.log(
          {
            organizationId,
            userId: actorUserId,
            action: "RFQ_SUPPLIER_PORTAL_REVOKED",
            entityType: "RFQSupplier",
            entityId: rfqSupplier.id,
            newValue: { rfqId: rfq.id, supplierId: rfqSupplier.supplierId },
          },
          tx
        );
      }
      // else: idempotent no-op — the end state it's asking for is already true; no audit.

      const fresh = await tx.rFQSupplier.findUniqueOrThrow({
        where: { id: rfqSupplier.id },
        include: { supplier: { select: { status: true } } },
      });
      return toRfqSupplierView(fresh);
    });
  }

  // ────────────────────────────────────────────────────────────
  // INTERNAL BOUNDED QUOTE READ (Architecture §16)
  // ────────────────────────────────────────────────────────────

  async getQuote(organizationId: string, rfqId: string, rfqSupplierId: string): Promise<QuoteView> {
    const rfqSupplier = await this.db.rFQSupplier.findFirst({
      where: { id: rfqSupplierId, rfqId, rfq: { organizationId } },
      select: { id: true, rfqId: true, supplierId: true, supplierCodeSnapshot: true, companyNameSnapshot: true },
    });
    if (!rfqSupplier) throw new NotFoundException("RFQ supplier not found");

    const quote = await this.db.quote.findUnique({ where: { rfqSupplierId: rfqSupplier.id }, include: { items: true } });
    if (!quote) throw new NotFoundException("Quote not found");

    return toQuoteView({
      ...quote,
      items: quote.items,
      rfqId: rfqSupplier.rfqId,
      rfqSupplierId: rfqSupplier.id,
      supplierId: rfqSupplier.supplierId,
      supplierCodeSnapshot: rfqSupplier.supplierCodeSnapshot,
      companyNameSnapshot: rfqSupplier.companyNameSnapshot,
    });
  }

  // ────────────────────────────────────────────────────────────
  // Shared helpers
  // ────────────────────────────────────────────────────────────

  private requireSentWithFutureDeadline(rfq: { status: string; deadline: Date | null }, now: Date): void {
    if (rfq.status !== "SENT") throw new ConflictException(`RFQ must be SENT to manage portal access (current status: ${rfq.status})`);
    if (!rfq.deadline) throw new ConflictException("RFQ has no deadline");
    if (rfq.deadline.getTime() <= now.getTime()) throw new ConflictException("RFQ deadline has passed");
  }
}
