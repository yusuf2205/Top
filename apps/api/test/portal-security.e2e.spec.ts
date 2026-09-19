import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createSystemPrismaClient } from "@top/database";
import { createTestApp, uniqueEmail } from "./test-app";

/**
 * M3.4 Supplier Portal Phase C — external auth isolation matrix
 * (Architecture §60-61): missing/garbage/expired/revoked tokens across all
 * four portal routes, internal-JWT-does-not-authorize-portal-routes, and
 * portal-bearer-does-not-authorize-internal-routes. Budget-conscious: the
 * full failure-mode x route matrix is probed primarily via the cheap (60/min)
 * GET route, with one representative confirmation call per mutating route
 * rather than a full cross-product, to stay under the 10/min throttle on
 * open/quote/decline within this one file.
 */

interface OrgContext {
  accessToken: string;
}

async function registerOrg(app: INestApplication, orgName: string): Promise<OrgContext> {
  const email = uniqueEmail("psec");
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
function portal(app: INestApplication, token: string | undefined) {
  const set = (req: request.Test) => (token !== undefined ? req.set("Authorization", `Bearer ${token}`) : req);
  return {
    post: (url: string) => set(request(app.getHttpServer()).post(url)),
    get: (url: string) => set(request(app.getHttpServer()).get(url)),
  };
}

const futureDeadline = () => new Date(Date.now() + 7 * 86400000).toISOString();

async function createApprovedPR(app: INestApplication, admin: OrgContext) {
  const pr = await authed(app, admin.accessToken).post("/api/v1/purchase-requests").send({ items: [{ itemName: "Item", quantity: "1.000", uomCode: "PCS" }] });
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
  return { pr, supplier, rfq, rfqSupplierId, rawToken: invite.body.token as string };
}

describe("M3.4 Supplier Portal — external auth isolation", () => {
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

  it("missing/garbage/expired/revoked tokens are all 401 on GET, with the identical generic message", async () => {
    const admin = await registerOrg(app, "Security Missing Org");
    const { rfqSupplierId, rawToken } = await buildInvitedSupplier(app, admin);

    const missing = await portal(app, undefined).get("/api/v1/portal/rfq");
    expect(missing.status).toBe(401);

    const garbage = await portal(app, "not-a-real-token").get("/api/v1/portal/rfq");
    expect(garbage.status).toBe(401);

    await db.rFQSupplier.update({ where: { id: rfqSupplierId }, data: { tokenExpiresAt: new Date(Date.now() - 1000) } });
    const expired = await portal(app, rawToken).get("/api/v1/portal/rfq");
    expect(expired.status).toBe(401);

    await db.rFQSupplier.update({ where: { id: rfqSupplierId }, data: { tokenExpiresAt: new Date(Date.now() + 60000), portalTokenHash: null } });
    const revoked = await portal(app, rawToken).get("/api/v1/portal/rfq");
    expect(revoked.status).toBe(401);

    // The real security property: all four genuinely different failure
    // reasons (missing/garbage/expired/revoked) produce a BYTE-IDENTICAL
    // response body — an attacker cannot distinguish them. The guard's own
    // fixed generic message text ("Invalid or expired portal credential")
    // legitimately contains the word "expired" as a permanent part of its
    // wording, used identically for all four cases — that is not a leak,
    // since it never varies with the actual reason. A substring-based check
    // for "expired"/"revoked" would therefore incorrectly flag the guard's
    // own constant message rather than proving anything about leakage.
    const messages = new Set([missing.body.message, garbage.body.message, expired.body.message, revoked.body.message]);
    expect(messages.size).toBe(1);
    const bodies = [missing.body, garbage.body, expired.body, revoked.body];
    for (const body of bodies) {
      expect(JSON.stringify(body)).toBe(JSON.stringify(bodies[0]));
    }
  });

  it("a garbage token is rejected (401) on OPEN, QUOTE, and DECLINE too — not just GET (guards run before the body validation pipe, so auth fails first even with an invalid body)", async () => {
    const badToken = "0".repeat(64);
    expect((await portal(app, badToken).post("/api/v1/portal/rfq/open")).status).toBe(401);
    expect(
      (await portal(app, badToken).post("/api/v1/portal/rfq/quote").send({ currency: "USD", vatIncluded: false, deliveryCost: "0", deliveryIncluded: true, items: [] })).status
    ).toBe(401);
    expect((await portal(app, badToken).post("/api/v1/portal/rfq/decline")).status).toBe(401);
  });

  it("an internal JWT alone (no portal bearer) never authorizes a portal route", async () => {
    const admin = await registerOrg(app, "Security Internal JWT Org");
    const res = await portal(app, admin.accessToken).get("/api/v1/portal/rfq");
    expect(res.status).toBe(401);
  });

  it("a valid portal bearer never authorizes an internal /rfqs route", async () => {
    const admin = await registerOrg(app, "Security Portal Vs Internal Org");
    const { rfq, rawToken } = await buildInvitedSupplier(app, admin);
    const res = await request(app.getHttpServer()).get(`/api/v1/rfqs/${rfq.id}`).set("Authorization", `Bearer ${rawToken}`);
    expect(res.status).toBe(401);
  });
});
