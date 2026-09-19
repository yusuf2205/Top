import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createSystemPrismaClient } from "@top/database";
import { AuditService } from "../src/common/audit/audit.service";
import { createTestApp, uniqueEmail } from "./test-app";

/**
 * M3.4 Supplier Portal Phase C — internal portal-access management
 * (invite/reissue/revoke/bounded quote read). RBAC, tenant/IDOR, exact
 * transaction semantics, audit atomicity. External portal-facing behavior
 * lives in the portal-*.e2e.spec.ts files (these internal routes carry no
 * rate limiting — Architecture §8).
 */

interface OrgContext {
  email: string;
  accessToken: string;
  userId: string;
  organizationId: string;
}

async function registerOrg(app: INestApplication, orgName: string): Promise<OrgContext> {
  const email = uniqueEmail("rpa");
  const password = "correct-horse-battery-staple";
  const res = await request(app.getHttpServer()).post("/api/v1/auth/register").send({ organizationName: orgName, fullName: "Admin", email, password });
  return { email, accessToken: res.body.accessToken as string, userId: res.body.user.id as string, organizationId: res.body.user.organizationId as string };
}

async function inviteAndLogin(app: INestApplication, admin: OrgContext, role: string): Promise<OrgContext> {
  const email = uniqueEmail(role.toLowerCase());
  const password = "correct-horse-battery-staple";
  const invite = await request(app.getHttpServer()).post("/api/v1/members/invitations").set("Authorization", `Bearer ${admin.accessToken}`).send({ email, role });
  await request(app.getHttpServer()).post(`/api/v1/invitations/${invite.body.rawToken as string}/accept`).send({ fullName: "Test User", password });
  const login = await request(app.getHttpServer()).post("/api/v1/auth/login").send({ email, password });
  return { email, accessToken: login.body.accessToken as string, userId: login.body.user.id as string, organizationId: admin.organizationId };
}

function authed(app: INestApplication, token: string) {
  return {
    get: (url: string) => request(app.getHttpServer()).get(url).set("Authorization", `Bearer ${token}`),
    post: (url: string) => request(app.getHttpServer()).post(url).set("Authorization", `Bearer ${token}`),
  };
}

const freeTextItem = { itemName: "Steel pipe DN50", quantity: "20.000", uomCode: "M" };
const futureDeadline = () => new Date(Date.now() + 7 * 86400000).toISOString();

async function createApprovedPR(app: INestApplication, admin: OrgContext, items: Record<string, unknown>[] = [freeTextItem]) {
  const pr = await authed(app, admin.accessToken).post("/api/v1/purchase-requests").send({ items });
  if (pr.status !== 201) throw new Error(`postPR failed: ${pr.status} ${JSON.stringify(pr.body)}`);
  const submit = await authed(app, admin.accessToken).post(`/api/v1/purchase-requests/${pr.body.id}/submit`);
  if (submit.status !== 200) throw new Error(`submit failed: ${submit.status}`);
  const approve = await authed(app, admin.accessToken).post(`/api/v1/purchase-requests/${pr.body.id}/approve`);
  if (approve.status !== 200) throw new Error(`approve failed: ${approve.status}`);
  return pr.body as { id: string; requestNumber: string; items: Array<{ id: string }> };
}

async function createSupplierActive(app: INestApplication, token: string, companyName = "Test Supplier") {
  const res = await authed(app, token).post("/api/v1/suppliers").send({ companyName });
  if (res.status !== 201) throw new Error(`createSupplier failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string; supplierCode: string; companyName: string; status: string };
}

/** Builds a fully SENT RFQ with exactly one SELECTED RFQSupplier — the common starting point for every invite/reissue/revoke test. */
async function buildSentRfqWithSelectedSupplier(app: INestApplication, admin: OrgContext) {
  const pr = await createApprovedPR(app, admin);
  const supplier = await createSupplierActive(app, admin.accessToken);
  const rfqRes = await authed(app, admin.accessToken)
    .post("/api/v1/rfqs")
    .send({ purchaseRequestId: pr.id, purchaseRequestItemIds: [pr.items[0]!.id], supplierIds: [supplier.id], deadline: futureDeadline() });
  if (rfqRes.status !== 201) throw new Error(`createRfq failed: ${rfqRes.status} ${JSON.stringify(rfqRes.body)}`);
  const rfq = rfqRes.body as { id: string; rfqNumber: string; suppliers: Array<{ id: string }> };
  const send = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/send`);
  if (send.status !== 200) throw new Error(`send failed: ${send.status} ${JSON.stringify(send.body)}`);
  return { pr, supplier, rfq, rfqSupplierId: rfq.suppliers[0]!.id };
}

describe("M3.4 Supplier Portal — internal portal-access management", () => {
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

  // ────────────────────────────────────────────────────────────
  // INVITE
  // ────────────────────────────────────────────────────────────

  describe("invite", () => {
    it("issues a raw token once, hashes it, sets INVITED, and never returns the hash", async () => {
      const admin = await registerOrg(app, "Invite Org");
      const { rfq, rfqSupplierId } = await buildSentRfqWithSelectedSupplier(app, admin);

      const res = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/invite`);
      expect(res.status).toBe(200);
      expect(typeof res.body.token).toBe("string");
      expect(res.body.token.length).toBeGreaterThan(20);
      expect(res.body).not.toHaveProperty("portalTokenHash");
      expect(res.body).not.toHaveProperty("hash");
      expect(JSON.stringify(res.body)).not.toContain("Hash");

      const row = await db.rFQSupplier.findUnique({ where: { id: rfqSupplierId } });
      expect(row?.status).toBe("INVITED");
      expect(row?.portalTokenHash).not.toBeNull();
      expect(row?.invitedAt).not.toBeNull();
      expect(row?.viewedAt).toBeNull();
      expect(row?.tokenExpiresAt?.getTime()).toBeGreaterThan(Date.now());

      expect(await db.auditLog.count({ where: { entityId: rfqSupplierId, action: "RFQ_SUPPLIER_INVITED" } })).toBe(1);
    });

    it("sets tokenExpiresAt to exactly RFQ.deadline + 7 days", async () => {
      const admin = await registerOrg(app, "Invite Expiry Org");
      const { rfq, rfqSupplierId } = await buildSentRfqWithSelectedSupplier(app, admin);
      const rfqRow = await db.rFQ.findUniqueOrThrow({ where: { id: rfq.id } });

      await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/invite`);

      const row = await db.rFQSupplier.findUniqueOrThrow({ where: { id: rfqSupplierId } });
      const expectedExpiry = rfqRow.deadline!.getTime() + 7 * 24 * 60 * 60 * 1000;
      expect(row.tokenExpiresAt!.getTime()).toBe(expectedExpiry);
    });

    it("rejects inviting an already-credentialed supplier (must use reissue)", async () => {
      const admin = await registerOrg(app, "Invite Twice Org");
      const { rfq, rfqSupplierId } = await buildSentRfqWithSelectedSupplier(app, admin);
      await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/invite`);

      const second = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/invite`);
      expect(second.status).toBe(409);
    });

    it("rejects inviting when RFQ is DRAFT", async () => {
      const admin = await registerOrg(app, "Invite Draft Org");
      const pr = await createApprovedPR(app, admin);
      const supplier = await createSupplierActive(app, admin.accessToken);
      const rfqRes = await authed(app, admin.accessToken).post("/api/v1/rfqs").send({ purchaseRequestId: pr.id, supplierIds: [supplier.id] });
      const rfqSupplierId = rfqRes.body.suppliers[0].id;

      const res = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfqRes.body.id}/suppliers/${rfqSupplierId}/invite`);
      expect(res.status).toBe(409);
    });

    it("rejects inviting when RFQ is CANCELLED", async () => {
      const admin = await registerOrg(app, "Invite Cancelled Org");
      const { rfq, rfqSupplierId } = await buildSentRfqWithSelectedSupplier(app, admin);
      await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/cancel`);

      const res = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/invite`);
      expect(res.status).toBe(409);
    });

    it("rejects inviting when RFQ is CLOSED", async () => {
      const admin = await registerOrg(app, "Invite Closed Org");
      const { rfq, rfqSupplierId } = await buildSentRfqWithSelectedSupplier(app, admin);
      await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/close`);

      const res = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/invite`);
      expect(res.status).toBe(409);
    });

    it("cross-RFQ same-tenant rfqSupplierId is 404, not leaked as a different error", async () => {
      const admin = await registerOrg(app, "Invite Cross RFQ Org");
      const a = await buildSentRfqWithSelectedSupplier(app, admin);
      const b = await buildSentRfqWithSelectedSupplier(app, admin);

      const res = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${a.rfq.id}/suppliers/${b.rfqSupplierId}/invite`);
      expect(res.status).toBe(404);
    });

    it("cross-org rfqSupplierId/rfqId are both 404", async () => {
      const orgA = await registerOrg(app, "Invite IDOR A");
      const orgB = await registerOrg(app, "Invite IDOR B");
      const a = await buildSentRfqWithSelectedSupplier(app, orgA);
      const b = await buildSentRfqWithSelectedSupplier(app, orgB);

      expect((await authed(app, orgA.accessToken).post(`/api/v1/rfqs/${a.rfq.id}/suppliers/${b.rfqSupplierId}/invite`)).status).toBe(404);
      expect((await authed(app, orgA.accessToken).post(`/api/v1/rfqs/${b.rfq.id}/suppliers/${a.rfqSupplierId}/invite`)).status).toBe(404);
    });
  });

  // ────────────────────────────────────────────────────────────
  // REISSUE
  // ────────────────────────────────────────────────────────────

  describe("reissue", () => {
    it("overwrites the hash, resets viewedAt to null, sets status INVITED — old token stops working", async () => {
      const admin = await registerOrg(app, "Reissue Org");
      const { rfq, rfqSupplierId } = await buildSentRfqWithSelectedSupplier(app, admin);
      const invite = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/invite`);
      const oldToken = invite.body.token as string;

      // Move to VIEWED first via portal open, so we can prove reissue resets viewedAt.
      await request(app.getHttpServer()).post("/api/v1/portal/rfq/open").set("Authorization", `Bearer ${oldToken}`);
      expect((await db.rFQSupplier.findUniqueOrThrow({ where: { id: rfqSupplierId } })).status).toBe("VIEWED");

      const reissue = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/reissue`);
      expect(reissue.status).toBe(200);
      const newToken = reissue.body.token as string;
      expect(newToken).not.toBe(oldToken);

      const row = await db.rFQSupplier.findUniqueOrThrow({ where: { id: rfqSupplierId } });
      expect(row.status).toBe("INVITED");
      expect(row.viewedAt).toBeNull();

      // Old token now fails.
      const oldOpen = await request(app.getHttpServer()).post("/api/v1/portal/rfq/open").set("Authorization", `Bearer ${oldToken}`);
      expect(oldOpen.status).toBe(401);
      // New token works.
      const newOpen = await request(app.getHttpServer()).post("/api/v1/portal/rfq/open").set("Authorization", `Bearer ${newToken}`);
      expect(newOpen.status).toBe(200);

      expect(await db.auditLog.count({ where: { entityId: rfqSupplierId, action: "RFQ_SUPPLIER_PORTAL_REISSUED" } })).toBe(1);
    });

    it("reissue is the sanctioned reactivation path for a DECLINED supplier", async () => {
      const admin = await registerOrg(app, "Reissue Declined Org");
      const { rfq, rfqSupplierId } = await buildSentRfqWithSelectedSupplier(app, admin);
      const invite = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/invite`);
      const declineRes = await request(app.getHttpServer()).post("/api/v1/portal/rfq/decline").set("Authorization", `Bearer ${invite.body.token}`);
      expect(declineRes.status).toBe(200);
      expect((await db.rFQSupplier.findUniqueOrThrow({ where: { id: rfqSupplierId } })).status).toBe("DECLINED");

      const reissue = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/reissue`);
      expect(reissue.status).toBe(200);
      expect((await db.rFQSupplier.findUniqueOrThrow({ where: { id: rfqSupplierId } })).status).toBe("INVITED");
    });

    it("rejects reissuing a SELECTED (never-invited) supplier — must use invite", async () => {
      const admin = await registerOrg(app, "Reissue Selected Org");
      const { rfq, rfqSupplierId } = await buildSentRfqWithSelectedSupplier(app, admin);

      const res = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/reissue`);
      expect(res.status).toBe(409);
    });

    it("rejects reissuing a SUBMITTED supplier", async () => {
      const admin = await registerOrg(app, "Reissue Submitted Org");
      const { rfq, rfqSupplierId } = await buildSentRfqWithSelectedSupplier(app, admin);
      const invite = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/invite`);
      const rfqItem = await db.rFQItem.findFirstOrThrow({ where: { rfqId: rfq.id } });
      const submit = await request(app.getHttpServer())
        .post("/api/v1/portal/rfq/quote")
        .set("Authorization", `Bearer ${invite.body.token}`)
        .send({ currency: "USD", vatIncluded: false, deliveryCost: "0", deliveryIncluded: true, items: [{ rfqItemId: rfqItem.id, unitPrice: "1.0000" }] });
      expect(submit.status).toBe(200);

      const res = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/reissue`);
      expect(res.status).toBe(409);
    });

    it("cross-RFQ same-tenant and cross-org rfqSupplierId are 404", async () => {
      const admin = await registerOrg(app, "Reissue IDOR Org");
      const a = await buildSentRfqWithSelectedSupplier(app, admin);
      const b = await buildSentRfqWithSelectedSupplier(app, admin);
      await authed(app, admin.accessToken).post(`/api/v1/rfqs/${a.rfq.id}/suppliers/${a.rfqSupplierId}/invite`);

      const res = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${a.rfq.id}/suppliers/${b.rfqSupplierId}/reissue`);
      expect(res.status).toBe(404);
    });
  });

  // ────────────────────────────────────────────────────────────
  // REVOKE
  // ────────────────────────────────────────────────────────────

  describe("revoke", () => {
    it("nulls hash+expiry, leaves status/invitedAt/viewedAt untouched, returns bounded RfqSupplierView with portalAccessActive=false", async () => {
      const admin = await registerOrg(app, "Revoke Org");
      const { rfq, rfqSupplierId } = await buildSentRfqWithSelectedSupplier(app, admin);
      const invite = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/invite`);
      await request(app.getHttpServer()).post("/api/v1/portal/rfq/open").set("Authorization", `Bearer ${invite.body.token}`);
      const beforeRow = await db.rFQSupplier.findUniqueOrThrow({ where: { id: rfqSupplierId } });

      const res = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/revoke`);
      expect(res.status).toBe(200);
      expect(res.body.portalAccessActive).toBe(false);
      expect(res.body.portalAccessExpiresAt).toBeNull();
      expect(res.body).not.toHaveProperty("portalTokenHash");

      const row = await db.rFQSupplier.findUniqueOrThrow({ where: { id: rfqSupplierId } });
      expect(row.portalTokenHash).toBeNull();
      expect(row.tokenExpiresAt).toBeNull();
      expect(row.status).toBe(beforeRow.status);
      expect(row.invitedAt?.getTime()).toBe(beforeRow.invitedAt?.getTime());
      expect(row.viewedAt?.getTime()).toBe(beforeRow.viewedAt?.getTime());

      // Old token no longer works.
      const openAfter = await request(app.getHttpServer()).post("/api/v1/portal/rfq/open").set("Authorization", `Bearer ${invite.body.token}`);
      expect(openAfter.status).toBe(401);

      expect(await db.auditLog.count({ where: { entityId: rfqSupplierId, action: "RFQ_SUPPLIER_PORTAL_REVOKED" } })).toBe(1);
    });

    it("repeated revoke is a 200 no-op with no duplicate audit", async () => {
      const admin = await registerOrg(app, "Revoke Repeat Org");
      const { rfq, rfqSupplierId } = await buildSentRfqWithSelectedSupplier(app, admin);
      await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/invite`);
      await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/revoke`);

      const second = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/revoke`);
      expect(second.status).toBe(200);

      expect(await db.auditLog.count({ where: { entityId: rfqSupplierId, action: "RFQ_SUPPLIER_PORTAL_REVOKED" } })).toBe(1);
    });

    it("revoke succeeds even for a never-invited (SELECTED) supplier — no-op", async () => {
      const admin = await registerOrg(app, "Revoke Never Invited Org");
      const { rfq, rfqSupplierId } = await buildSentRfqWithSelectedSupplier(app, admin);

      const res = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/revoke`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("SELECTED");
    });

    it("revoke succeeds after RFQ CLOSED (does not require SENT)", async () => {
      const admin = await registerOrg(app, "Revoke Closed Org");
      const { rfq, rfqSupplierId } = await buildSentRfqWithSelectedSupplier(app, admin);
      await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/invite`);
      await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/close`);

      const res = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/revoke`);
      expect(res.status).toBe(200);
      expect(res.body.portalAccessActive).toBe(false);
    });

    it("revoke succeeds after RFQ CANCELLED", async () => {
      const admin = await registerOrg(app, "Revoke Cancelled Org");
      const { rfq, rfqSupplierId } = await buildSentRfqWithSelectedSupplier(app, admin);
      await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/invite`);
      await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/cancel`);

      const res = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/revoke`);
      expect(res.status).toBe(200);
    });

    it("cross-RFQ same-tenant and cross-org rfqSupplierId are 404", async () => {
      const orgA = await registerOrg(app, "Revoke IDOR A");
      const orgB = await registerOrg(app, "Revoke IDOR B");
      const a = await buildSentRfqWithSelectedSupplier(app, orgA);
      const b = await buildSentRfqWithSelectedSupplier(app, orgB);
      const aSecond = await buildSentRfqWithSelectedSupplier(app, orgA);

      expect((await authed(app, orgA.accessToken).post(`/api/v1/rfqs/${a.rfq.id}/suppliers/${aSecond.rfqSupplierId}/revoke`)).status).toBe(404);
      expect((await authed(app, orgA.accessToken).post(`/api/v1/rfqs/${a.rfq.id}/suppliers/${b.rfqSupplierId}/revoke`)).status).toBe(404);
    });
  });

  // ────────────────────────────────────────────────────────────
  // INTERNAL RBAC (invite/reissue/revoke/quote-read — full 6-role HTTP matrix)
  // ────────────────────────────────────────────────────────────

  describe("internal RBAC", () => {
    it("ADMIN/PROCUREMENT_MANAGER/PROCUREMENT_SPECIALIST can invite/reissue/revoke/read-quote; EMPLOYEE/APPROVER/SUPPLIER cannot (403)", async () => {
      const admin = await registerOrg(app, "Portal RBAC Org");
      const manager = await inviteAndLogin(app, admin, "PROCUREMENT_MANAGER");
      const specialist = await inviteAndLogin(app, admin, "PROCUREMENT_SPECIALIST");
      const employee = await inviteAndLogin(app, admin, "EMPLOYEE");
      const approver = await inviteAndLogin(app, admin, "APPROVER");
      const supplierRole = await inviteAndLogin(app, admin, "SUPPLIER");

      for (const denied of [employee, approver, supplierRole]) {
        const { rfq, rfqSupplierId } = await buildSentRfqWithSelectedSupplier(app, admin);
        expect((await authed(app, denied.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/invite`)).status).toBe(403);
        expect((await authed(app, denied.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/reissue`)).status).toBe(403);
        expect((await authed(app, denied.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/revoke`)).status).toBe(403);
        expect((await authed(app, denied.accessToken).get(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/quote`)).status).toBe(403);
      }

      for (const allowed of [manager, specialist]) {
        const { rfq, rfqSupplierId } = await buildSentRfqWithSelectedSupplier(app, admin);
        expect((await authed(app, allowed.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/invite`)).status).toBe(200);
        expect((await authed(app, allowed.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/reissue`)).status).toBe(200);
        expect((await authed(app, allowed.accessToken).get(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/quote`)).status).toBe(404); // no Quote yet — bounded 404, not a crash
        expect((await authed(app, allowed.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/revoke`)).status).toBe(200);
      }
    });
  });

  // ────────────────────────────────────────────────────────────
  // INTERNAL QUOTE READ
  // ────────────────────────────────────────────────────────────

  describe("internal quote read", () => {
    it("returns 404 when no Quote exists yet", async () => {
      const admin = await registerOrg(app, "Quote Read None Org");
      const { rfq, rfqSupplierId } = await buildSentRfqWithSelectedSupplier(app, admin);
      const res = await authed(app, admin.accessToken).get(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/quote`);
      expect(res.status).toBe(404);
    });

    it("returns the bounded QuoteView once a Quote is submitted, with no payloadHash/portalTokenHash/AI/attachment/PO fields", async () => {
      const admin = await registerOrg(app, "Quote Read Org");
      const { rfq, rfqSupplierId } = await buildSentRfqWithSelectedSupplier(app, admin);
      const invite = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/invite`);
      const rfqItem = await db.rFQItem.findFirstOrThrow({ where: { rfqId: rfq.id } });
      await request(app.getHttpServer())
        .post("/api/v1/portal/rfq/quote")
        .set("Authorization", `Bearer ${invite.body.token}`)
        .send({ currency: "USD", vatIncluded: false, deliveryCost: "10.00", deliveryIncluded: false, items: [{ rfqItemId: rfqItem.id, unitPrice: "5.0000" }] });

      const res = await authed(app, admin.accessToken).get(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/quote`);
      expect(res.status).toBe(200);
      expect(res.body.rfqSupplierId).toBe(rfqSupplierId);
      expect(res.body.supplierId).toBeDefined();
      // unitPrice 5.0000 * quantity 20.000 (freeTextItem default) = 100 exactly — decimal.js does not
      // zero-pad a multiplication/addition result to the combined operand scale, only the genuinely
      // significant digits are kept (confirmed empirically, not assumed).
      expect(res.body.subtotal).toBe("100");
      expect(res.body.totalBeforeVat).toBe("110");
      for (const forbidden of ["payloadHash", "portalTokenHash", "tokenExpiresAt", "aiExtraction", "attachments", "purchaseOrders"]) {
        expect(res.body).not.toHaveProperty(forbidden);
      }
    });

    it("cross-org quote read is 404, no existence leak", async () => {
      const orgA = await registerOrg(app, "Quote Read IDOR A");
      const orgB = await registerOrg(app, "Quote Read IDOR B");
      const b = await buildSentRfqWithSelectedSupplier(app, orgB);
      const res = await authed(app, orgA.accessToken).get(`/api/v1/rfqs/${b.rfq.id}/suppliers/${b.rfqSupplierId}/quote`);
      expect(res.status).toBe(404);
    });
  });

  // ────────────────────────────────────────────────────────────
  // AUDIT ROLLBACK
  // ────────────────────────────────────────────────────────────

  describe("audit rollback (mutation + audit atomicity)", () => {
    it("invite rolls back completely on AuditLog failure — raw token never returned, DB stays SELECTED", async () => {
      const admin = await registerOrg(app, "Invite Rollback Org");
      const { rfq, rfqSupplierId } = await buildSentRfqWithSelectedSupplier(app, admin);

      const spy = jest.spyOn(audit, "log").mockRejectedValueOnce(new Error("simulated audit failure"));
      try {
        const res = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/invite`);
        expect(res.status).toBe(500);
        expect(res.body).not.toHaveProperty("token");
      } finally {
        spy.mockRestore();
      }

      const row = await db.rFQSupplier.findUniqueOrThrow({ where: { id: rfqSupplierId } });
      expect(row.portalTokenHash).toBeNull();
      expect(row.tokenExpiresAt).toBeNull();
      expect(row.invitedAt).toBeNull();
      expect(row.status).toBe("SELECTED");
    });

    it("reissue rolls back completely on AuditLog failure — old token remains valid", async () => {
      const admin = await registerOrg(app, "Reissue Rollback Org");
      const { rfq, rfqSupplierId } = await buildSentRfqWithSelectedSupplier(app, admin);
      const invite = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/invite`);
      const oldToken = invite.body.token as string;
      const before = await db.rFQSupplier.findUniqueOrThrow({ where: { id: rfqSupplierId } });

      const spy = jest.spyOn(audit, "log").mockRejectedValueOnce(new Error("simulated audit failure"));
      try {
        const res = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/reissue`);
        expect(res.status).toBe(500);
        expect(res.body).not.toHaveProperty("token");
      } finally {
        spy.mockRestore();
      }

      const after = await db.rFQSupplier.findUniqueOrThrow({ where: { id: rfqSupplierId } });
      expect(after.portalTokenHash).toBe(before.portalTokenHash);

      const openWithOld = await request(app.getHttpServer()).post("/api/v1/portal/rfq/open").set("Authorization", `Bearer ${oldToken}`);
      expect(openWithOld.status).toBe(200);
    });

    it("revoke rolls back completely on AuditLog failure — credential remains valid", async () => {
      const admin = await registerOrg(app, "Revoke Rollback Org");
      const { rfq, rfqSupplierId } = await buildSentRfqWithSelectedSupplier(app, admin);
      const invite = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/invite`);

      const spy = jest.spyOn(audit, "log").mockRejectedValueOnce(new Error("simulated audit failure"));
      try {
        const res = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/revoke`);
        expect(res.status).toBe(500);
      } finally {
        spy.mockRestore();
      }

      const row = await db.rFQSupplier.findUniqueOrThrow({ where: { id: rfqSupplierId } });
      expect(row.portalTokenHash).not.toBeNull();

      const open = await request(app.getHttpServer()).post("/api/v1/portal/rfq/open").set("Authorization", `Bearer ${invite.body.token}`);
      expect(open.status).toBe(200);
    });
  });
});
