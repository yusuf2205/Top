import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createSystemPrismaClient } from "@top/database";
import { createTestApp, uniqueEmail } from "./test-app";

/**
 * M3.4 Supplier Portal Phase C — QUOTE REPLAY, group B: successful replay
 * after the Supplier master record later becomes non-ACTIVE, plus the
 * changed-payload conflict case (Architecture §32-33, §72-73).
 */

interface OrgContext {
  accessToken: string;
}

async function registerOrg(app: INestApplication, orgName: string): Promise<OrgContext> {
  const email = uniqueEmail("pqrb");
  const password = "correct-horse-battery-staple";
  const res = await request(app.getHttpServer()).post("/api/v1/auth/register").send({ organizationName: orgName, fullName: "Admin", email, password });
  return { accessToken: res.body.accessToken as string };
}

function authed(app: INestApplication, token: string) {
  return {
    post: (url: string) => request(app.getHttpServer()).post(url).set("Authorization", `Bearer ${token}`),
    patch: (url: string) => request(app.getHttpServer()).patch(url).set("Authorization", `Bearer ${token}`),
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
  return { pr, supplier, rfq, rfqSupplierId, rawToken: invite.body.token as string, rfqItemId: detail.body.items[0].id as string };
}

const basicPayload = (rfqItemId: string) => ({ currency: "USD", vatIncluded: false, deliveryCost: "0", deliveryIncluded: true, items: [{ rfqItemId, unitPrice: "5.0000" }] });

describe("M3.4 Supplier Portal — QUOTE REPLAY (group B: non-ACTIVE Supplier, changed payload)", () => {
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

  it.each(["INACTIVE", "BLOCKED", "ARCHIVED"])("replay remains 200 after the Supplier later becomes %s", async (status) => {
    const admin = await registerOrg(app, `Replay ${status} Org`);
    const { supplier, rawToken, rfqItemId } = await buildInvitedSupplier(app, admin);
    const first = await portal(app, rawToken).post("/api/v1/portal/rfq/quote").send(basicPayload(rfqItemId));
    expect(first.status).toBe(200);

    await authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}/status`).send({ status });

    const replay = await portal(app, rawToken).post("/api/v1/portal/rfq/quote").send(basicPayload(rfqItemId));
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(first.body.id);
  });

  it("changed payload after SUBMITTED returns 409, does not overwrite the original Quote", async () => {
    const admin = await registerOrg(app, "Replay Changed Payload Org");
    const { rfqSupplierId, rawToken, rfqItemId } = await buildInvitedSupplier(app, admin);
    const first = await portal(app, rawToken).post("/api/v1/portal/rfq/quote").send(basicPayload(rfqItemId));
    expect(first.status).toBe(200);

    const changed = await portal(app, rawToken)
      .post("/api/v1/portal/rfq/quote")
      .send({ currency: "USD", vatIncluded: false, deliveryCost: "0", deliveryIncluded: true, items: [{ rfqItemId, unitPrice: "999.0000" }] });
    expect(changed.status).toBe(409);

    const quote = await db.quote.findUniqueOrThrow({ where: { rfqSupplierId }, include: { items: true } });
    // decimal.js's Decimal does not preserve input trailing zeros on .toString()
    // (confirmed empirically) — "5.0000" round-trips as "5", still exactly the
    // original value, never rounded/changed to "999".
    expect(quote.items[0]!.unitPrice.toString()).toBe("5");
    expect(quote.source).toBe("PORTAL");
    expect(await db.quote.count({ where: { rfqSupplierId } })).toBe(1);
    // Integration Audit (Final Remaining Gate) §1: no audit row on conflict —
    // only the one QUOTE_SUBMITTED row from the original successful submit.
    expect(await db.auditLog.count({ where: { entityId: quote.id } })).toBe(1);
  });
});
