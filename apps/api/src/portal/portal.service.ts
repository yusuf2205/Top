import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@top/database";
import type { createTenantSafePrismaClient } from "@top/database";
import type { SubmitQuoteInput } from "@top/validation";
import type { SupplierPortalQuoteView, SupplierPortalRfqView } from "@top/types";
import { TENANT_PRISMA } from "../database/database.module";
import type { TenantTransactionClient } from "../database/database.module";
import { AuditService } from "../common/audit/audit.service";
import type { PortalContext } from "../common/types/authenticated-request";
import { lockRfq, lockRfqSupplier, lockSuppliersByIds } from "../rfqs/rfq-locks";
import { computeQuoteSubmitHash } from "./quote-submit-hash.util";
import { toSupplierPortalQuoteView, toSupplierPortalRfqView } from "./portal-serializers";

type TenantDb = ReturnType<typeof createTenantSafePrismaClient>;

const GENERIC_UNAUTHORIZED = "Invalid or expired portal credential";
const SUPPLIER_VISIBLE_RFQ_STATUSES = new Set(["SENT", "CLOSED", "CANCELLED"]);

const rfqReadSelect = {
  id: true,
  rfqNumber: true,
  status: true,
  deadline: true,
  supplierInstructions: true,
} satisfies Prisma.RFQSelect;

/**
 * M3.4 Supplier Portal Phase C (Architecture §19-45). External portal
 * business logic — the guard (PortalAuthGuard) only authenticates; every
 * mutating method here re-validates the credential UNDER LOCK (Revision 1
 * §7) before trusting it, because guard-time validity says nothing about
 * validity at commit-time (a concurrent revoke/reissue could have
 * superseded it in between).
 *
 * Reuses the EXACT SAME `TENANT_PRISMA` client and lock helpers
 * (`lockRfq`/`lockRfqSupplier`/`lockSuppliersByIds`) that `RfqsService`
 * uses — this works because `TenantContextInterceptor`'s Phase B additive
 * fallback (`request.user?.organizationId ?? request.portalContext?.
 * organizationId`) has already established the AsyncLocalStorage tenant
 * context by the time this service's methods run (guards always complete
 * before interceptors — empirically proven, see
 * portal/portal-tenant-context-order.spec.ts).
 */
@Injectable()
export class PortalService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantDb,
    private readonly audit: AuditService
  ) {}

  // ────────────────────────────────────────────────────────────
  // OPEN — locks RFQSupplier only (+ bounded RFQ read), idempotent
  // INVITED -> VIEWED transition (Architecture §19)
  // ────────────────────────────────────────────────────────────

  async open(ctx: PortalContext): Promise<SupplierPortalRfqView> {
    return this.db.$transaction(async (tx) => {
      const now = new Date();
      const rfqSupplier = await lockRfqSupplier(tx, ctx.organizationId, ctx.rfqSupplierId);
      this.assertOwnContext(rfqSupplier, ctx);
      this.revalidateCredential(rfqSupplier, ctx, now);

      const rfq = await tx.rFQ.findFirst({ where: { id: rfqSupplier.rfqId, organizationId: ctx.organizationId }, select: rfqReadSelect });
      if (!rfq) throw new UnauthorizedException(GENERIC_UNAUTHORIZED);
      this.assertSupplierVisible(rfq.status);

      let myStatus: string = rfqSupplier.status;
      if (rfqSupplier.status === "SELECTED") {
        // Credential exists but participation never advanced past SELECTED —
        // structurally unreachable via any real Invite/Reissue path (both
        // always set status=INVITED in the same transaction as the hash).
        throw new InternalServerErrorException("Inconsistent portal access state");
      }
      if (rfqSupplier.status === "EXPIRED") {
        // Dormant — M3.4 never persists this transition — but handled safely
        // rather than crashing if a future/legacy row ever carries it.
        throw new ConflictException("Portal access has expired");
      }
      if (rfqSupplier.status === "INVITED") {
        await tx.rFQSupplier.update({ where: { id: rfqSupplier.id }, data: { status: "VIEWED", viewedAt: now } });
        await this.audit.log(
          {
            organizationId: ctx.organizationId,
            userId: null,
            action: "RFQ_SUPPLIER_VIEWED",
            entityType: "RFQSupplier",
            entityId: rfqSupplier.id,
            newValue: { rfqId: rfqSupplier.rfqId, supplierId: rfqSupplier.supplierId },
          },
          tx
        );
        myStatus = "VIEWED";
      }
      // VIEWED / SUBMITTED / DECLINED: no-op, no audit, no write (repeated open must never duplicate the transition).

      return this.buildRfqViewTx(tx, rfq, myStatus, rfqSupplier.id);
    });
  }

  // ────────────────────────────────────────────────────────────
  // GET — pure read, no audit, no write (Architecture §20)
  // ────────────────────────────────────────────────────────────

  async get(ctx: PortalContext): Promise<SupplierPortalRfqView> {
    const now = new Date();
    const rfqSupplier = await this.db.rFQSupplier.findFirst({
      where: { id: ctx.rfqSupplierId },
      select: { id: true, rfqId: true, supplierId: true, status: true, portalTokenHash: true, tokenExpiresAt: true },
    });
    if (!rfqSupplier) throw new UnauthorizedException(GENERIC_UNAUTHORIZED);
    this.assertOwnContext(rfqSupplier, ctx);
    this.revalidateCredential(rfqSupplier, ctx, now);

    const rfq = await this.db.rFQ.findFirst({ where: { id: rfqSupplier.rfqId, organizationId: ctx.organizationId }, select: rfqReadSelect });
    if (!rfq) throw new UnauthorizedException(GENERIC_UNAUTHORIZED);
    this.assertSupplierVisible(rfq.status);

    return this.buildRfqView(rfq, rfqSupplier.status, rfqSupplier.id);
  }

  // ────────────────────────────────────────────────────────────
  // DECLINE (Architecture §42-44)
  // ────────────────────────────────────────────────────────────

  async decline(ctx: PortalContext): Promise<SupplierPortalRfqView> {
    return this.db.$transaction(async (tx) => {
      const now = new Date();
      const rfq = await lockRfq(tx, ctx.organizationId, ctx.rfqId);
      const rfqSupplier = await lockRfqSupplier(tx, ctx.organizationId, ctx.rfqSupplierId);
      this.assertOwnContext(rfqSupplier, ctx);
      this.revalidateCredential(rfqSupplier, ctx, now);

      if (rfqSupplier.status === "DECLINED") {
        // Replay of an already-committed decline — no new mutation, no duplicate audit.
        return this.buildRfqViewTx(tx, rfq, "DECLINED", rfqSupplier.id);
      }
      if (rfqSupplier.status === "SUBMITTED") throw new ConflictException("A quote has already been submitted");
      if (rfqSupplier.status === "SELECTED") throw new ConflictException("Not invited");
      if (rfqSupplier.status === "EXPIRED") throw new ConflictException("Portal access has expired");
      // INVITED / VIEWED -> new decline.

      if (rfq.status !== "SENT") throw new ConflictException(`RFQ is not open for a response (status ${rfq.status})`);
      if (!rfq.deadline || rfq.deadline.getTime() < now.getTime()) throw new ConflictException("Response deadline has passed");

      const [supplier] = await lockSuppliersByIds(tx, ctx.organizationId, [ctx.supplierId]);
      if (!supplier || supplier.status !== "ACTIVE") throw new ConflictException("Supplier is not ACTIVE");

      await tx.rFQSupplier.update({ where: { id: rfqSupplier.id }, data: { status: "DECLINED" } });
      await this.audit.log(
        {
          organizationId: ctx.organizationId,
          userId: null,
          action: "RFQ_SUPPLIER_DECLINED",
          entityType: "RFQSupplier",
          entityId: rfqSupplier.id,
          newValue: { rfqId: rfq.id, supplierId: ctx.supplierId },
        },
        tx
      );

      return this.buildRfqViewTx(tx, rfq, "DECLINED", rfqSupplier.id);
    });
  }

  // ────────────────────────────────────────────────────────────
  // QUOTE SUBMIT (Architecture §28-41, Revision 2)
  // ────────────────────────────────────────────────────────────

  async submitQuote(ctx: PortalContext, input: SubmitQuoteInput): Promise<SupplierPortalQuoteView> {
    // Pure computation, before any lock/DB read (Revision 2 §3).
    const incomingPayloadHash = computeQuoteSubmitHash(input);

    return this.db.$transaction(async (tx) => {
      const now = new Date();
      const rfq = await lockRfq(tx, ctx.organizationId, ctx.rfqId);
      const rfqSupplier = await lockRfqSupplier(tx, ctx.organizationId, ctx.rfqSupplierId);
      this.assertOwnContext(rfqSupplier, ctx);
      this.revalidateCredential(rfqSupplier, ctx, now);

      // Participation status inspected BEFORE any new-submission business
      // check (Revision 2) — the replay branch must survive RFQ/deadline/
      // Supplier state changes that happened AFTER the original submission.
      if (rfqSupplier.status === "SUBMITTED") {
        return this.resolveQuoteReplay(tx, rfqSupplier.id, incomingPayloadHash);
      }
      if (rfqSupplier.status === "SELECTED") throw new ConflictException("Not invited");
      if (rfqSupplier.status === "DECLINED") throw new ConflictException("Quote already declined");
      if (rfqSupplier.status === "EXPIRED") throw new ConflictException("Portal access has expired");
      // INVITED / VIEWED -> new submission.

      if (rfq.status !== "SENT") throw new ConflictException(`RFQ is not open for submission (status ${rfq.status})`);
      if (!rfq.deadline || rfq.deadline.getTime() < now.getTime()) throw new ConflictException("Submission deadline has passed");

      const [supplier] = await lockSuppliersByIds(tx, ctx.organizationId, [ctx.supplierId]);
      if (!supplier || supplier.status !== "ACTIVE") throw new ConflictException("Supplier is not ACTIVE");

      const rfqItems = await tx.rFQItem.findMany({ where: { rfqId: rfq.id } });
      this.assertCompleteItemCoverage(rfqItems, input.items);

      // Defense-in-depth (§38): Quote + SUBMITTED must move atomically —
      // this should be structurally unreachable (nothing else can create a
      // Quote for a row still INVITED/VIEWED), but never silently overwrite.
      const existingQuote = await tx.quote.findUnique({ where: { rfqSupplierId: rfqSupplier.id } });
      if (existingQuote) throw new InternalServerErrorException("Inconsistent quote state");

      let quote: { id: string };
      try {
        quote = await tx.quote.create({
          data: {
            rfqSupplierId: rfqSupplier.id,
            payloadHash: incomingPayloadHash,
            // Multi-Channel Quote Intake Addendum §9: explicit, never
            // inferred from status/portalTokenHash/route — this IS the one
            // place that infers it, since this endpoint only ever handles
            // portal submissions; every other future intake channel must
            // set its own explicit source at its own creation call site.
            source: "PORTAL",
            currency: input.currency,
            vatRate: input.vatRate ?? null,
            vatIncluded: input.vatIncluded,
            deliveryCost: input.deliveryCost,
            deliveryIncluded: input.deliveryIncluded,
            leadTimeDays: input.leadTimeDays ?? null,
            paymentTerms: input.paymentTerms ?? null,
            warranty: input.warranty ?? null,
            notes: input.notes ?? null,
            status: "SUBMITTED",
            submittedAt: now,
          },
        });
      } catch (err) {
        // P2002 is SECONDARY defense only (§41) — the RFQSupplier row lock
        // is the primary mechanism, so this path is expected to be
        // unreachable in practice. Only treated as a replay collision when
        // the constraint metadata specifically names rfqSupplierId — never a
        // blanket catch of any P2002 (e.g. a QuoteItem unique violation
        // must never be silently reinterpreted as "already submitted").
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && this.isRfqSupplierUniqueViolation(err)) {
          return this.resolveQuoteReplay(tx, rfqSupplier.id, incomingPayloadHash);
        }
        throw err;
      }

      await tx.quoteItem.createMany({
        data: rfqItems.map((item) => ({
          quoteId: quote.id,
          rfqItemId: item.id,
          unitPrice: input.items.find((i) => i.rfqItemId === item.id)!.unitPrice,
          // Quantity is ALWAYS the authoritative RFQItem value — never client-supplied (§36).
          quantity: item.quantity,
        })),
      });

      await tx.rFQSupplier.update({ where: { id: rfqSupplier.id }, data: { status: "SUBMITTED" } });

      await this.audit.log(
        {
          organizationId: ctx.organizationId,
          userId: null,
          action: "QUOTE_SUBMITTED",
          entityType: "Quote",
          entityId: quote.id,
          // Bounded context only — never raw token/hash/payloadHash/full body (§40).
          newValue: { rfqId: rfq.id, rfqSupplierId: rfqSupplier.id, supplierId: ctx.supplierId, currency: input.currency, itemCount: rfqItems.length },
        },
        tx
      );

      const createdItems = await tx.quoteItem.findMany({ where: { quoteId: quote.id } });
      return toSupplierPortalQuoteView({
        id: quote.id,
        currency: input.currency,
        vatRate: input.vatRate ? new Prisma.Decimal(input.vatRate) : null,
        vatIncluded: input.vatIncluded,
        deliveryCost: new Prisma.Decimal(input.deliveryCost),
        deliveryIncluded: input.deliveryIncluded,
        leadTimeDays: input.leadTimeDays ?? null,
        paymentTerms: input.paymentTerms ?? null,
        warranty: input.warranty ?? null,
        notes: input.notes ?? null,
        status: "SUBMITTED",
        submittedAt: now,
        items: createdItems,
      });
    });
  }

  // ────────────────────────────────────────────────────────────
  // Shared helpers
  // ────────────────────────────────────────────────────────────

  /** Loaded/locked RFQSupplier must actually belong to the token's own context — defensive parity check (the guard already resolved this exact row, so a mismatch here would indicate a bug, never legitimate input; rfqId/supplierId are immutable on RFQSupplier once created, so this can never meaningfully fail today — kept as cheap, harmless defense-in-depth). */
  private assertOwnContext(rfqSupplier: { id: string; rfqId: string; supplierId: string }, ctx: PortalContext): void {
    if (rfqSupplier.id !== ctx.rfqSupplierId || rfqSupplier.rfqId !== ctx.rfqId || rfqSupplier.supplierId !== ctx.supplierId) {
      throw new UnauthorizedException(GENERIC_UNAUTHORIZED);
    }
  }

  /** Revision 1 §7 — mandatory under-lock (or fresh-read, for the non-mutating GET) revalidation: guard-time validity says nothing about validity right now. */
  private revalidateCredential(row: { portalTokenHash: string | null; tokenExpiresAt: Date | null }, ctx: PortalContext, now: Date): void {
    if (row.portalTokenHash !== ctx.tokenHash || !row.tokenExpiresAt || row.tokenExpiresAt.getTime() <= now.getTime()) {
      throw new UnauthorizedException(GENERIC_UNAUTHORIZED);
    }
  }

  private assertSupplierVisible(status: string): void {
    if (!SUPPLIER_VISIBLE_RFQ_STATUSES.has(status)) {
      // DRAFT/IN_PROGRESS are both structurally unreachable once a credential
      // exists (Invite only ever issues one while RFQ.status === SENT, and
      // nothing moves a SENT RFQ back to DRAFT; IN_PROGRESS is dormant and
      // never produced by M3.4) — handled safely rather than leaking either.
      throw new InternalServerErrorException("Inconsistent portal access state");
    }
  }

  private assertCompleteItemCoverage(rfqItems: Array<{ id: string }>, submitted: SubmitQuoteInput["items"]): void {
    const rfqItemIds = new Set(rfqItems.map((i) => i.id));
    const submittedIds = submitted.map((i) => i.rfqItemId);
    if (new Set(submittedIds).size !== submittedIds.length) {
      throw new BadRequestException("Duplicate rfqItemId in submission");
    }
    const missing = [...rfqItemIds].filter((id) => !submittedIds.includes(id));
    const foreign = submittedIds.filter((id) => !rfqItemIds.has(id));
    if (missing.length > 0 || foreign.length > 0) {
      throw new BadRequestException("Quote must cover exactly the RFQ's current items — no missing or foreign rfqItemId");
    }
  }

  private isRfqSupplierUniqueViolation(err: Prisma.PrismaClientKnownRequestError): boolean {
    const target = err.meta?.target;
    if (typeof target === "string") return target.includes("rfqSupplierId");
    if (Array.isArray(target)) return target.includes("rfqSupplierId");
    return false;
  }

  private async resolveQuoteReplay(tx: TenantTransactionClient, rfqSupplierId: string, incomingPayloadHash: string): Promise<SupplierPortalQuoteView> {
    const existing = await tx.quote.findUnique({ where: { rfqSupplierId }, include: { items: true } });
    if (!existing) throw new InternalServerErrorException("Inconsistent quote state");
    // Multi-Channel Quote Intake Addendum §20/§49: a Quote created through a
    // DIFFERENT intake channel (MANUAL/FILE_IMPORT/EMAIL/TELEGRAM/WHATSAPP,
    // or a null-source legacy row) must never be treated as a Portal replay,
    // even if its payloadHash happens to equal the incoming one — exact
    // replay semantics belong only to "the same originating Portal
    // operation". Checked BEFORE the payloadHash comparison so a
    // coincidental hash match can never short-circuit this.
    if (existing.source !== "PORTAL") {
      throw new ConflictException("Quote already submitted through another intake channel");
    }
    if (existing.payloadHash !== null && existing.payloadHash === incomingPayloadHash) {
      return toSupplierPortalQuoteView(existing);
    }
    throw new ConflictException(existing.payloadHash === null ? "Quote already submitted" : "Quote already submitted with a different payload");
  }

  private async buildRfqView(
    rfq: { id: string; rfqNumber: string; status: string; deadline: Date | null; supplierInstructions: string | null },
    myStatus: string,
    rfqSupplierId: string
  ): Promise<SupplierPortalRfqView> {
    const [items, myQuote] = await Promise.all([
      this.db.rFQItem.findMany({ where: { rfqId: rfq.id } }),
      this.db.quote.findUnique({ where: { rfqSupplierId }, include: { items: true } }),
    ]);
    return toSupplierPortalRfqView({ ...rfq, items, myStatus, myQuote });
  }

  private async buildRfqViewTx(
    tx: TenantTransactionClient,
    rfq: { id: string; rfqNumber: string; status: string; deadline: Date | null; supplierInstructions: string | null },
    myStatus: string,
    rfqSupplierId: string
  ): Promise<SupplierPortalRfqView> {
    const [items, myQuote] = await Promise.all([
      tx.rFQItem.findMany({ where: { rfqId: rfq.id } }),
      tx.quote.findUnique({ where: { rfqSupplierId }, include: { items: true } }),
    ]);
    return toSupplierPortalRfqView({ ...rfq, items, myStatus, myQuote });
  }
}
