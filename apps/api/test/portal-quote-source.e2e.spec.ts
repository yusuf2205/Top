import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createSystemPrismaClient } from "@top/database";
import { createTestApp, uniqueEmail } from "./test-app";

/**
 * M3.4 Multi-Channel Quote Intake Addendum §26 — Quote.source coverage:
 * a portal submission sets source=PORTAL, replay never rewrites it, the
 * external SupplierPortalQuoteView never exposes it, the internal QuoteView
 * does, and a pre-addendum ("legacy") Quote row with source=null serializes
 * safely (never inferred/backfilled to any specific channel). Isolated in
 * its own file (own app instance = own throttle-budget counter) to avoid
 * competing with the other portal-quote-*.e2e.spec.ts files' 10/min "quote"
 * route budgets.
 */

interface OrgContext {
  accessToken: string;
}

async function registerOrg(app: INestApplication, orgName: string): Promise<OrgContext> {
  const email = uniqueEmail("pqsrc");
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
async function buildSentRfqWithSelectedSupplier(app: INestApplication, admin: OrgContext) {
  const pr = await createApprovedPR(app, admin);
  const supplier = await createSupplierActive(app, admin.accessToken);
  const rfqRes = await authed(app, admin.accessToken)
    .post("/api/v1/rfqs")
    .send({ purchaseRequestId: pr.id, purchaseRequestItemIds: [pr.items[0]!.id], supplierIds: [supplier.id], deadline: futureDeadline() });
  const rfq = rfqRes.body as { id: string; suppliers: Array<{ id: string }> };
  await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/send`);
  const rfqSupplierId = rfq.suppliers[0]!.id;
  const detail = await authed(app, admin.accessToken).get(`/api/v1/rfqs/${rfq.id}`);
  return { pr, supplier, rfq, rfqSupplierId, rfqItemId: detail.body.items[0].id as string };
}
async function invite(app: INestApplication, admin: OrgContext, rfqId: string, rfqSupplierId: string) {
  const res = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfqId}/suppliers/${rfqSupplierId}/invite`);
  return res.body.token as string;
}

const basicPayload = (rfqItemId: string) => ({ currency: "USD", vatIncluded: false, deliveryCost: "0", deliveryIncluded: true, items: [{ rfqItemId, unitPrice: "5.0000" }] });

describe("M3.4 Supplier Portal — Quote.source (Multi-Channel Quote Intake Addendum)", () => {
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

  it("a portal submission sets Quote.source = PORTAL in the DB, exposes it on the internal QuoteView, and never exposes it on the external SupplierPortalQuoteView", async () => {
    const admin = await registerOrg(app, "Source Basic Org");
    const { rfq, rfqSupplierId, rfqItemId } = await buildSentRfqWithSelectedSupplier(app, admin);
    const rawToken = await invite(app, admin, rfq.id, rfqSupplierId);

    const res = await portal(app, rawToken).post("/api/v1/portal/rfq/quote").send(basicPayload(rfqItemId));
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("source");
    expect(res.body).not.toHaveProperty("payloadHash");
    expect(res.body).not.toHaveProperty("portalTokenHash");
    // Exact-shape assertion (Integration Audit §28) — not just property-name
    // absence checks: proves the external view is exactly this closed set,
    // so "source" (or any future field) cannot silently sneak in later.
    expect(Object.keys(res.body).sort()).toEqual(
      ["id", "currency", "vatRate", "vatIncluded", "deliveryCost", "deliveryIncluded", "leadTimeDays", "paymentTerms", "warranty", "notes", "status", "submittedAt", "items", "subtotal", "totalBeforeVat"].sort()
    );

    const row = await db.quote.findUniqueOrThrow({ where: { rfqSupplierId } });
    expect(row.source).toBe("PORTAL");

    const internal = await authed(app, admin.accessToken).get(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/quote`);
    expect(internal.status).toBe(200);
    expect(internal.body.source).toBe("PORTAL");
    expect(internal.body).not.toHaveProperty("payloadHash");
  });

  it("replaying the same payload (200) never rewrites source — remains PORTAL, not null, not duplicated", async () => {
    const admin = await registerOrg(app, "Source Replay Org");
    const { rfq, rfqSupplierId, rfqItemId } = await buildSentRfqWithSelectedSupplier(app, admin);
    const rawToken = await invite(app, admin, rfq.id, rfqSupplierId);

    const first = await portal(app, rawToken).post("/api/v1/portal/rfq/quote").send(basicPayload(rfqItemId));
    expect(first.status).toBe(200);

    const replay = await portal(app, rawToken).post("/api/v1/portal/rfq/quote").send(basicPayload(rfqItemId));
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(first.body.id);
    expect(replay.body).not.toHaveProperty("source");

    const row = await db.quote.findUniqueOrThrow({ where: { rfqSupplierId } });
    expect(row.source).toBe("PORTAL");
    expect(await db.quote.count({ where: { rfqSupplierId } })).toBe(1);
    // Integration Audit (Final Remaining Gate) §1: a 200 replay adds no NEW
    // audit row — only the one QUOTE_SUBMITTED row from the original submit.
    expect(await db.auditLog.count({ where: { entityId: first.body.id } })).toBe(1);
  });

  it("a pre-addendum ('legacy') Quote row with source=null serializes safely on the internal QuoteView — never inferred/backfilled to PORTAL or any other channel", async () => {
    const admin = await registerOrg(app, "Source Legacy Org");
    const { rfq, rfqSupplierId } = await buildSentRfqWithSelectedSupplier(app, admin);

    // Simulate a pre-addendum row: created directly (never through the portal
    // submit endpoint, so no `source` is ever set), exactly like a Quote row
    // that existed in the DB before this addendum shipped.
    await db.quote.create({ data: { rfqSupplierId, currency: "USD" } });

    const internal = await authed(app, admin.accessToken).get(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/quote`);
    expect(internal.status).toBe(200);
    expect(internal.body.source).toBeNull();
  });
});
