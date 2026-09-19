import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createSystemPrismaClient } from "@top/database";
import { createTestApp, uniqueEmail } from "./test-app";
import { computeQuoteSubmitHash } from "../src/portal/quote-submit-hash.util";

/**
 * M3.4 Phase B+C Integration Audit §49 — CRITICAL multi-channel correctness
 * fix: a Portal quote submit against an RFQSupplier already SUBMITTED must
 * NOT treat a coincidentally-equal payloadHash as a valid Portal replay when
 * the existing Quote's `source` is NOT PORTAL. Only `source === PORTAL AND
 * payloadHash matches` qualifies as an idempotent Portal replay — a Quote
 * from any other channel (or a null-source legacy row) must always be a 409
 * "already submitted through another intake channel", never a silent 200.
 *
 * Since M3.5+ intake channels don't exist yet, the "existing Quote from
 * another channel" state is simulated directly via Prisma (RFQSupplier
 * forced to SUBMITTED + a directly-inserted Quote row) — exactly the state
 * a future Manual/File/Email/Telegram/WhatsApp intake endpoint will leave
 * behind. The payloadHash is computed with the REAL `computeQuoteSubmitHash`
 * (the same pure function the Portal endpoint itself uses) so the "hash
 * happens to match" premise is exact, not approximate.
 *
 * Isolated in its own file (own app instance = own throttle-budget counter):
 * 6 source values × 1 "quote" route call each = 6, well under the file's
 * 10/min budget.
 */

interface OrgContext {
  accessToken: string;
}

async function registerOrg(app: INestApplication, orgName: string): Promise<OrgContext> {
  const email = uniqueEmail("pqrs");
  const password = "correct-horse-battery-staple";
  const res = await request(app.getHttpServer()).post("/api/v1/auth/register").send({ organizationName: orgName, fullName: "Admin", email, password });
  return { accessToken: res.body.accessToken as string };
}

function authed(app: INestApplication, token: string) {
  return {
    post: (url: string) => request(app.getHttpServer()).post(url).set("Authorization", `Bearer ${token}`),
    get: (url: string) => request(app.getHttpServer()).get(url).set("Authorization", `Bearer ${token}`),
  };
}
function portal(app: INestApplication, token: string) {
  return { post: (url: string) => request(app.getHttpServer()).post(url).set("Authorization", `Bearer ${token}`) };
}

const futureDeadline = () => new Date(Date.now() + 7 * 86400000).toISOString();

async function createApprovedPR(app: INestApplication, admin: OrgContext) {
  const pr = await authed(app, admin.accessToken).post("/api/v1/purchase-requests").send({ items: [{ itemName: "Item", quantity: "3.500", uomCode: "PCS" }] });
  await authed(app, admin.accessToken).post(`/api/v1/purchase-requests/${pr.body.id}/submit`);
  await authed(app, admin.accessToken).post(`/api/v1/purchase-requests/${pr.body.id}/approve`);
  return pr.body as { id: string; items: Array<{ id: string }> };
}
async function createSupplierActive(app: INestApplication, token: string) {
  const res = await authed(app, token).post("/api/v1/suppliers").send({ companyName: "Test Supplier" });
  return res.body as { id: string };
}
async function buildInvitedSupplier(app: INestApplication, admin: OrgContext) {
  const pr = await createApprovedPR(app, admin);
  const supplier = await createSupplierActive(app, admin.accessToken);
  const rfqRes = await authed(app, admin.accessToken)
    .post("/api/v1/rfqs")
    .send({ purchaseRequestId: pr.id, purchaseRequestItemIds: [pr.items[0]!.id], supplierIds: [supplier.id], deadline: futureDeadline() });
  const rfq = rfqRes.body as { id: string; suppliers: Array<{ id: string }> };
  await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/send`);
  const rfqSupplierId = rfq.suppliers[0]!.id;
  const invite = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/invite`);
  const detail = await authed(app, admin.accessToken).get(`/api/v1/rfqs/${rfq.id}`);
  return { rfqSupplierId, rawToken: invite.body.token as string, rfqItemId: detail.body.items[0].id as string };
}

const basicPayload = (rfqItemId: string) => ({ currency: "USD", vatIncluded: false, deliveryCost: "0", deliveryIncluded: true, items: [{ rfqItemId, unitPrice: "5.0000" }] });

describe("M3.4 Supplier Portal — QUOTE REPLAY source discrimination (Integration Audit §49)", () => {
  let app: INestApplication;
  let db: ReturnType<typeof createSystemPrismaClient>;

  beforeAll(async () => {
    app = await createTestApp();
    db = createSystemPrismaClient();
  });

  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  it.each([null, "MANUAL", "FILE_IMPORT", "EMAIL", "TELEGRAM", "WHATSAPP"] as const)(
    "a Portal submit against an already-SUBMITTED RFQSupplier whose Quote has source=%s and a COINCIDENTALLY-MATCHING payloadHash returns 409, never a silent 200 replay",
    async (otherSource) => {
      const admin = await registerOrg(app, `Replay Source ${otherSource ?? "null"} Org`);
      const { rfqSupplierId, rawToken, rfqItemId } = await buildInvitedSupplier(app, admin);
      const payload = basicPayload(rfqItemId);
      const matchingHash = computeQuoteSubmitHash(payload);

      // Simulate the state a future non-Portal intake channel (or a legacy
      // pre-addendum row) would leave behind — never through the Portal
      // submit endpoint itself.
      await db.rFQSupplier.update({ where: { id: rfqSupplierId }, data: { status: "SUBMITTED" } });
      const quote = await db.quote.create({
        data: { rfqSupplierId, currency: "USD", deliveryCost: "0", deliveryIncluded: true, payloadHash: matchingHash, source: otherSource, status: "SUBMITTED" },
      });
      await db.quoteItem.create({ data: { quoteId: quote.id, rfqItemId, unitPrice: "5.0000", quantity: "3.500" } });

      const res = await portal(app, rawToken).post("/api/v1/portal/rfq/quote").send(payload);
      expect(res.status).toBe(409);

      // Never silently overwritten/reinterpreted as a Portal Quote.
      const row = await db.quote.findUniqueOrThrow({ where: { rfqSupplierId } });
      expect(row.id).toBe(quote.id);
      expect(row.source).toBe(otherSource);
      expect(await db.quote.count({ where: { rfqSupplierId } })).toBe(1);
      // Integration Audit (Final Remaining Gate) §1: no audit row on conflict —
      // resolveQuoteReplay's source-mismatch branch never calls audit.log.
      expect(await db.auditLog.count({ where: { entityId: quote.id } })).toBe(0);
    }
  );
});
