import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createSystemPrismaClient } from "@top/database";
import { AuditService } from "../src/common/audit/audit.service";
import { createTestApp, uniqueEmail } from "./test-app";

/**
 * M3.4 Supplier Portal Phase C — QUOTE REPLAY, group C: failure paths
 * (legacy null payloadHash, SUBMITTED-with-no-Quote invariant, revoked/
 * expired credential before the replay branch is ever reached) plus the
 * submit audit-rollback test (Architecture §31, §73, §57).
 */

interface OrgContext {
  accessToken: string;
}

async function registerOrg(app: INestApplication, orgName: string): Promise<OrgContext> {
  const email = uniqueEmail("pqrc");
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
  return { pr, supplier, rfq, rfqSupplierId, rawToken: invite.body.token as string, rfqItemId: detail.body.items[0].id as string };
}

const basicPayload = (rfqItemId: string) => ({ currency: "USD", vatIncluded: false, deliveryCost: "0", deliveryIncluded: true, items: [{ rfqItemId, unitPrice: "5.0000" }] });

describe("M3.4 Supplier Portal — QUOTE REPLAY (group C: failure paths + audit rollback)", () => {
  let app: INestApplication;
  let db: ReturnType<typeof createSystemPrismaClient>;
  let audit: AuditService;

  beforeAll(async () => {
    app = await createTestApp();
    db = createSystemPrismaClient();
    audit = app.get(AuditService);
  });

  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  it("legacy Quote with payloadHash=null cannot be proven equal — 409, never silently replayed", async () => {
    const admin = await registerOrg(app, "Replay Legacy Null Org");
    const { rfqSupplierId, rawToken, rfqItemId } = await buildInvitedSupplier(app, admin);
    const first = await portal(app, rawToken).post("/api/v1/portal/rfq/quote").send(basicPayload(rfqItemId));
    expect(first.status).toBe(200);

    await db.quote.update({ where: { rfqSupplierId }, data: { payloadHash: null } });
    const quoteId = first.body.id as string;

    const replay = await portal(app, rawToken).post("/api/v1/portal/rfq/quote").send(basicPayload(rfqItemId));
    expect(replay.status).toBe(409);

    const row = await db.quote.findUniqueOrThrow({ where: { rfqSupplierId } });
    expect(row.source).toBe("PORTAL");
    expect(await db.quote.count({ where: { rfqSupplierId } })).toBe(1);
    // Integration Audit (Final Remaining Gate) §1: no audit row on conflict —
    // only the one QUOTE_SUBMITTED row from the original successful submit.
    expect(await db.auditLog.count({ where: { entityId: quoteId } })).toBe(1);
  });

  it("SUBMITTED with no Quote row is a safe invariant failure — never creates a second/replacement Quote", async () => {
    const admin = await registerOrg(app, "Replay No Quote Org");
    const { rfqSupplierId, rawToken, rfqItemId } = await buildInvitedSupplier(app, admin);
    const first = await portal(app, rawToken).post("/api/v1/portal/rfq/quote").send(basicPayload(rfqItemId));
    expect(first.status).toBe(200);
    const quoteId = first.body.id as string;

    await db.quoteItem.deleteMany({ where: { quoteId } });
    await db.quote.delete({ where: { id: quoteId } });

    const retry = await portal(app, rawToken).post("/api/v1/portal/rfq/quote").send(basicPayload(rfqItemId));
    expect(retry.status).toBe(500);
    expect(await db.quote.count({ where: { rfqSupplierId } })).toBe(0);
  });

  it("a revoked credential is rejected (401) before the replay branch is ever reached", async () => {
    const admin = await registerOrg(app, "Replay Revoked Org");
    const { rfq, rfqSupplierId, rawToken, rfqItemId } = await buildInvitedSupplier(app, admin);
    const first = await portal(app, rawToken).post("/api/v1/portal/rfq/quote").send(basicPayload(rfqItemId));
    expect(first.status).toBe(200);

    await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/revoke`);

    const replay = await portal(app, rawToken).post("/api/v1/portal/rfq/quote").send(basicPayload(rfqItemId));
    expect(replay.status).toBe(401);
  });

  it("an expired credential is rejected (401) before the replay branch is ever reached", async () => {
    const admin = await registerOrg(app, "Replay Expired Org");
    const { rfqSupplierId, rawToken, rfqItemId } = await buildInvitedSupplier(app, admin);
    const first = await portal(app, rawToken).post("/api/v1/portal/rfq/quote").send(basicPayload(rfqItemId));
    expect(first.status).toBe(200);

    await db.rFQSupplier.update({ where: { id: rfqSupplierId }, data: { tokenExpiresAt: new Date(Date.now() - 1000) } });

    const replay = await portal(app, rawToken).post("/api/v1/portal/rfq/quote").send(basicPayload(rfqItemId));
    expect(replay.status).toBe(401);
  });

  it("audit rollback: forced failure on a NEW submission leaves no Quote/QuoteItems and RFQSupplier not SUBMITTED", async () => {
    const admin = await registerOrg(app, "Submit Rollback Org");
    const { rfqSupplierId, rawToken, rfqItemId } = await buildInvitedSupplier(app, admin);

    const spy = jest.spyOn(audit, "log").mockRejectedValueOnce(new Error("simulated audit failure"));
    try {
      const res = await portal(app, rawToken).post("/api/v1/portal/rfq/quote").send(basicPayload(rfqItemId));
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }

    expect(await db.quote.count({ where: { rfqSupplierId } })).toBe(0);
    const row = await db.rFQSupplier.findUniqueOrThrow({ where: { id: rfqSupplierId } });
    expect(row.status).not.toBe("SUBMITTED");
  });
});
