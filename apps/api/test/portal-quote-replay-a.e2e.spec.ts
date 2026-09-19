import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createSystemPrismaClient } from "@top/database";
import { createTestApp, uniqueEmail } from "./test-app";

/**
 * M3.4 Supplier Portal Phase C — QUOTE REPLAY, group A: successful replay
 * after later RFQ CLOSED/CANCELLED/deadline-passed state changes
 * (Architecture §31-32, §72, Revision 2). Split across replay-a/b/c files to
 * stay under the `quote` route's 10/min throttle per file.
 */

interface OrgContext {
  accessToken: string;
}

async function registerOrg(app: INestApplication, orgName: string): Promise<OrgContext> {
  const email = uniqueEmail("pqra");
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

const futureDeadline = (ms = 7 * 86400000) => new Date(Date.now() + ms).toISOString();

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
async function buildInvitedSupplier(app: INestApplication, admin: OrgContext, deadlineIso = futureDeadline()) {
  const pr = await createApprovedPR(app, admin);
  const supplier = await createSupplierActive(app, admin.accessToken);
  const rfqRes = await authed(app, admin.accessToken)
    .post("/api/v1/rfqs")
    .send({ purchaseRequestId: pr.id, purchaseRequestItemIds: [pr.items[0]!.id], supplierIds: [supplier.id], deadline: deadlineIso });
  const rfq = rfqRes.body as { id: string; suppliers: Array<{ id: string }> };
  await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/send`);
  const rfqSupplierId = rfq.suppliers[0]!.id;
  const invite = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/invite`);
  const detail = await authed(app, admin.accessToken).get(`/api/v1/rfqs/${rfq.id}`);
  return { pr, supplier, rfq, rfqSupplierId, rawToken: invite.body.token as string, rfqItemId: detail.body.items[0].id as string };
}

const basicPayload = (rfqItemId: string) => ({ currency: "USD", vatIncluded: false, deliveryCost: "0", deliveryIncluded: true, items: [{ rfqItemId, unitPrice: "5.0000" }] });

describe("M3.4 Supplier Portal — QUOTE REPLAY (group A: closed/cancelled/deadline)", () => {
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

  it("exact same payload retry immediately after success: 200, same Quote id, no second audit", async () => {
    const admin = await registerOrg(app, "Replay Basic Org");
    const { rfqSupplierId, rawToken, rfqItemId } = await buildInvitedSupplier(app, admin);
    const first = await portal(app, rawToken).post("/api/v1/portal/rfq/quote").send(basicPayload(rfqItemId));
    expect(first.status).toBe(200);

    const second = await portal(app, rawToken).post("/api/v1/portal/rfq/quote").send(basicPayload(rfqItemId));
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);

    const quote = await db.quote.findUniqueOrThrow({ where: { rfqSupplierId } });
    expect(await db.auditLog.count({ where: { entityId: quote.id, action: "QUOTE_SUBMITTED" } })).toBe(1);
  });

  it("replay remains 200 after the RFQ is later CLOSED", async () => {
    const admin = await registerOrg(app, "Replay Closed Org");
    const { rfq, rawToken, rfqItemId } = await buildInvitedSupplier(app, admin);
    const first = await portal(app, rawToken).post("/api/v1/portal/rfq/quote").send(basicPayload(rfqItemId));
    expect(first.status).toBe(200);

    await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/close`);

    const replay = await portal(app, rawToken).post("/api/v1/portal/rfq/quote").send(basicPayload(rfqItemId));
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(first.body.id);
  });

  it("replay remains 200 after the RFQ is later CANCELLED", async () => {
    const admin = await registerOrg(app, "Replay Cancelled Org");
    const { rfq, rawToken, rfqItemId } = await buildInvitedSupplier(app, admin);
    const first = await portal(app, rawToken).post("/api/v1/portal/rfq/quote").send(basicPayload(rfqItemId));
    expect(first.status).toBe(200);

    await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/cancel`);

    const replay = await portal(app, rawToken).post("/api/v1/portal/rfq/quote").send(basicPayload(rfqItemId));
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(first.body.id);
  });

  it("replay remains 200 after the deadline has passed (token still valid for 7 more days)", async () => {
    const admin = await registerOrg(app, "Replay Deadline Org");
    // A deadline just barely in the future so send() succeeds, then we wait past it.
    const { rawToken, rfqItemId, rfqSupplierId } = await buildInvitedSupplier(app, admin, futureDeadline(3000));
    const first = await portal(app, rawToken).post("/api/v1/portal/rfq/quote").send(basicPayload(rfqItemId));
    expect(first.status).toBe(200);

    // Force the deadline into the past directly (avoids a real 3s sleep in the test).
    await db.rFQ.update({ where: { id: (await db.rFQSupplier.findUniqueOrThrow({ where: { id: rfqSupplierId } })).rfqId }, data: { deadline: new Date(Date.now() - 1000) } });

    const replay = await portal(app, rawToken).post("/api/v1/portal/rfq/quote").send(basicPayload(rfqItemId));
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(first.body.id);
  });
});
