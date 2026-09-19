import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createSystemPrismaClient } from "@top/database";
import { AuditService } from "../src/common/audit/audit.service";
import { createTestApp, uniqueEmail } from "./test-app";

/**
 * M3.4 Supplier Portal Phase C — external OPEN / GET / DECLINE (Architecture
 * §19-20, §42-44). Quote submission lives in portal-quote-submit.e2e.spec.ts
 * (kept separate so this file's own calls to the throttled `open`/`decline`
 * routes stay comfortably under their 10/min limits).
 */

interface OrgContext {
  accessToken: string;
  organizationId: string;
}

async function registerOrg(app: INestApplication, orgName: string): Promise<OrgContext> {
  const email = uniqueEmail("pogd");
  const password = "correct-horse-battery-staple";
  const res = await request(app.getHttpServer()).post("/api/v1/auth/register").send({ organizationName: orgName, fullName: "Admin", email, password });
  return { accessToken: res.body.accessToken as string, organizationId: res.body.user.organizationId as string };
}

function authed(app: INestApplication, token: string) {
  return {
    get: (url: string) => request(app.getHttpServer()).get(url).set("Authorization", `Bearer ${token}`),
    post: (url: string) => request(app.getHttpServer()).post(url).set("Authorization", `Bearer ${token}`),
    patch: (url: string) => request(app.getHttpServer()).patch(url).set("Authorization", `Bearer ${token}`),
  };
}
function portal(app: INestApplication, token: string) {
  return {
    get: (url: string) => request(app.getHttpServer()).get(url).set("Authorization", `Bearer ${token}`),
    post: (url: string) => request(app.getHttpServer()).post(url).set("Authorization", `Bearer ${token}`),
  };
}

const freeTextItem = { itemName: "Steel pipe DN50", quantity: "20.000", uomCode: "M" };
const futureDeadline = () => new Date(Date.now() + 7 * 86400000).toISOString();

async function createApprovedPR(app: INestApplication, admin: OrgContext, items: Record<string, unknown>[] = [freeTextItem]) {
  const pr = await authed(app, admin.accessToken).post("/api/v1/purchase-requests").send({ items });
  await authed(app, admin.accessToken).post(`/api/v1/purchase-requests/${pr.body.id}/submit`);
  await authed(app, admin.accessToken).post(`/api/v1/purchase-requests/${pr.body.id}/approve`);
  return pr.body as { id: string; items: Array<{ id: string }> };
}

async function createSupplierActive(app: INestApplication, token: string, companyName = "Test Supplier") {
  const res = await authed(app, token).post("/api/v1/suppliers").send({ companyName });
  return res.body as { id: string; status: string };
}

/** Full setup: SENT RFQ, one INVITED RFQSupplier, returns the raw portal token. */
async function buildInvitedSupplier(app: INestApplication, admin: OrgContext) {
  const pr = await createApprovedPR(app, admin);
  const supplier = await createSupplierActive(app, admin.accessToken);
  const rfqRes = await authed(app, admin.accessToken)
    .post("/api/v1/rfqs")
    .send({ purchaseRequestId: pr.id, purchaseRequestItemIds: [pr.items[0]!.id], supplierIds: [supplier.id], deadline: futureDeadline() });
  const rfq = rfqRes.body as { id: string; rfqNumber: string; suppliers: Array<{ id: string }> };
  await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/send`);
  const rfqSupplierId = rfq.suppliers[0]!.id;
  const invite = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/invite`);
  return { pr, supplier, rfq, rfqSupplierId, rawToken: invite.body.token as string };
}

describe("M3.4 Supplier Portal — OPEN / GET / DECLINE", () => {
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
  // OPEN
  // ────────────────────────────────────────────────────────────

  describe("open", () => {
    it("transitions INVITED -> VIEWED exactly once, sets viewedAt, audits RFQ_SUPPLIER_VIEWED, and returns the safe DTO", async () => {
      const admin = await registerOrg(app, "Open Org");
      const { rfq, rfqSupplierId, rawToken } = await buildInvitedSupplier(app, admin);

      const res = await portal(app, rawToken).post("/api/v1/portal/rfq/open");
      expect(res.status).toBe(200);
      expect(res.body.myStatus).toBe("VIEWED");
      expect(res.body.rfqNumber).toBe(rfq.rfqNumber);
      expect(res.body.myQuote).toBeNull();

      const row = await db.rFQSupplier.findUniqueOrThrow({ where: { id: rfqSupplierId } });
      expect(row.status).toBe("VIEWED");
      expect(row.viewedAt).not.toBeNull();
      expect(await db.auditLog.count({ where: { entityId: rfqSupplierId, action: "RFQ_SUPPLIER_VIEWED" } })).toBe(1);
    });

    it("repeated open is a no-op — no duplicate audit, no re-write of viewedAt", async () => {
      const admin = await registerOrg(app, "Open Repeat Org");
      const { rfqSupplierId, rawToken } = await buildInvitedSupplier(app, admin);

      await portal(app, rawToken).post("/api/v1/portal/rfq/open");
      const firstViewedAt = (await db.rFQSupplier.findUniqueOrThrow({ where: { id: rfqSupplierId } })).viewedAt;

      const second = await portal(app, rawToken).post("/api/v1/portal/rfq/open");
      expect(second.status).toBe(200);

      const row = await db.rFQSupplier.findUniqueOrThrow({ where: { id: rfqSupplierId } });
      expect(row.viewedAt?.getTime()).toBe(firstViewedAt?.getTime());
      expect(await db.auditLog.count({ where: { entityId: rfqSupplierId, action: "RFQ_SUPPLIER_VIEWED" } })).toBe(1);
    });

    it("audit rollback: forced failure on first open leaves status INVITED, viewedAt null, no audit — repeat open afterward works", async () => {
      const admin = await registerOrg(app, "Open Rollback Org");
      const { rfqSupplierId, rawToken } = await buildInvitedSupplier(app, admin);

      const spy = jest.spyOn(audit, "log").mockRejectedValueOnce(new Error("simulated audit failure"));
      try {
        const res = await portal(app, rawToken).post("/api/v1/portal/rfq/open");
        expect(res.status).toBe(500);
      } finally {
        spy.mockRestore();
      }

      const row = await db.rFQSupplier.findUniqueOrThrow({ where: { id: rfqSupplierId } });
      expect(row.status).toBe("INVITED");
      expect(row.viewedAt).toBeNull();
      expect(await db.auditLog.count({ where: { entityId: rfqSupplierId, action: "RFQ_SUPPLIER_VIEWED" } })).toBe(0);

      const retry = await portal(app, rawToken).post("/api/v1/portal/rfq/open");
      expect(retry.status).toBe(200);
    });

    it("remains accessible (read-only) after RFQ CLOSED and CANCELLED while credential valid", async () => {
      const admin = await registerOrg(app, "Open Closed Org");
      const closed = await buildInvitedSupplier(app, admin);
      await authed(app, admin.accessToken).post(`/api/v1/rfqs/${closed.rfq.id}/close`);
      const closedRes = await portal(app, closed.rawToken).post("/api/v1/portal/rfq/open");
      expect(closedRes.status).toBe(200);
      expect(closedRes.body.status).toBe("CLOSED");

      const admin2 = await registerOrg(app, "Open Cancelled Org");
      const cancelled = await buildInvitedSupplier(app, admin2);
      await authed(app, admin2.accessToken).post(`/api/v1/rfqs/${cancelled.rfq.id}/cancel`);
      const cancelledRes = await portal(app, cancelled.rawToken).post("/api/v1/portal/rfq/open");
      expect(cancelledRes.status).toBe(200);
      expect(cancelledRes.body.status).toBe("CANCELLED");
    });
  });

  // ────────────────────────────────────────────────────────────
  // GET
  // ────────────────────────────────────────────────────────────

  describe("get", () => {
    it("is a pure read — no audit, no status/viewedAt mutation", async () => {
      const admin = await registerOrg(app, "Get Pure Read Org");
      const { rfqSupplierId, rawToken } = await buildInvitedSupplier(app, admin);

      const res = await portal(app, rawToken).get("/api/v1/portal/rfq");
      expect(res.status).toBe(200);
      expect(res.body.myStatus).toBe("INVITED");

      const row = await db.rFQSupplier.findUniqueOrThrow({ where: { id: rfqSupplierId } });
      expect(row.status).toBe("INVITED");
      expect(row.viewedAt).toBeNull();
      expect(await db.auditLog.count({ where: { entityId: rfqSupplierId } })).toBe(1); // only the original RFQ_SUPPLIER_INVITED
    });

    it("reflects VIEWED after a prior open, and includes myQuote once submitted (cross-check via quote-submit file's own coverage) ", async () => {
      const admin = await registerOrg(app, "Get After Open Org");
      const { rawToken } = await buildInvitedSupplier(app, admin);
      await portal(app, rawToken).post("/api/v1/portal/rfq/open");

      const res = await portal(app, rawToken).get("/api/v1/portal/rfq");
      expect(res.status).toBe(200);
      expect(res.body.myStatus).toBe("VIEWED");
    });
  });

  // ────────────────────────────────────────────────────────────
  // DTO LEAK / SERIALIZATION BOUNDARY (open + get share the same serializer)
  // ────────────────────────────────────────────────────────────

  describe("DTO leak tests", () => {
    it("never exposes internalNotes, internalItemNote, or any other-supplier data — exact shape assertion with sentinel values", async () => {
      const admin = await registerOrg(app, "DTO Leak Org");
      const pr = await createApprovedPR(app, admin, [{ ...freeTextItem, notes: "SENTINEL_ITEM_NOTE" }]);
      const supplier = await createSupplierActive(app, admin.accessToken, "Visible Supplier");
      const otherSupplier = await createSupplierActive(app, admin.accessToken, "SENTINEL_OTHER_SUPPLIER_NAME");
      const rfqRes = await authed(app, admin.accessToken)
        .post("/api/v1/rfqs")
        .send({
          purchaseRequestId: pr.id,
          purchaseRequestItemIds: [pr.items[0]!.id],
          supplierIds: [supplier.id, otherSupplier.id],
          deadline: futureDeadline(),
          internalNotes: "SENTINEL_INTERNAL_RFQ_NOTE",
        });
      const rfq = rfqRes.body as { id: string; suppliers: Array<{ id: string; supplierId: string }> };
      await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/send`);
      const mySupplierId = rfq.suppliers.find((s) => s.supplierId === supplier.id)!.id;
      const invite = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${mySupplierId}/invite`);

      const res = await portal(app, invite.body.token).get("/api/v1/portal/rfq");
      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain("SENTINEL_ITEM_NOTE");
      expect(serialized).not.toContain("SENTINEL_INTERNAL_RFQ_NOTE");
      expect(serialized).not.toContain("SENTINEL_OTHER_SUPPLIER_NAME");
      expect(res.body).not.toHaveProperty("internalNotes");
      expect(res.body.items[0]).not.toHaveProperty("internalItemNote");
      expect(res.body).not.toHaveProperty("suppliers");
      expect(Object.keys(res.body).sort()).toEqual(["deadline", "items", "myQuote", "myStatus", "rfqNumber", "status", "supplierInstructions"].sort());
      expect(Object.keys(res.body.items[0]).sort()).toEqual(
        ["id", "itemName", "skuSnapshot", "description", "quantity", "uomCode", "technicalSpec", "requiredDate"].sort()
      );
    });
  });

  // ────────────────────────────────────────────────────────────
  // DECLINE
  // ────────────────────────────────────────────────────────────

  describe("decline", () => {
    it("INVITED -> DECLINED, audits RFQ_SUPPLIER_DECLINED, blocks a later submit", async () => {
      const admin = await registerOrg(app, "Decline Org");
      const { rfqSupplierId, rawToken } = await buildInvitedSupplier(app, admin);

      const res = await portal(app, rawToken).post("/api/v1/portal/rfq/decline");
      expect(res.status).toBe(200);
      expect(res.body.myStatus).toBe("DECLINED");

      const row = await db.rFQSupplier.findUniqueOrThrow({ where: { id: rfqSupplierId } });
      expect(row.status).toBe("DECLINED");
      expect(await db.auditLog.count({ where: { entityId: rfqSupplierId, action: "RFQ_SUPPLIER_DECLINED" } })).toBe(1);
    });

    it("repeated decline (still valid credential) is 200 no-op, no duplicate audit, even after RFQ CLOSED/deadline/Supplier non-ACTIVE", async () => {
      const admin = await registerOrg(app, "Decline Replay Org");
      const { rfq, rfqSupplierId, rawToken, supplier } = await buildInvitedSupplier(app, admin);
      await portal(app, rawToken).post("/api/v1/portal/rfq/decline");

      await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/close`);
      await authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}/status`).send({ status: "BLOCKED" });

      const second = await portal(app, rawToken).post("/api/v1/portal/rfq/decline");
      expect(second.status).toBe(200);
      expect(await db.auditLog.count({ where: { entityId: rfqSupplierId, action: "RFQ_SUPPLIER_DECLINED" } })).toBe(1);
    });

    it("audit rollback: forced failure leaves status INVITED/VIEWED, no audit", async () => {
      const admin = await registerOrg(app, "Decline Rollback Org");
      const { rfqSupplierId, rawToken } = await buildInvitedSupplier(app, admin);

      const spy = jest.spyOn(audit, "log").mockRejectedValueOnce(new Error("simulated audit failure"));
      try {
        const res = await portal(app, rawToken).post("/api/v1/portal/rfq/decline");
        expect(res.status).toBe(500);
      } finally {
        spy.mockRestore();
      }

      const row = await db.rFQSupplier.findUniqueOrThrow({ where: { id: rfqSupplierId } });
      expect(row.status).toBe("INVITED");
    });
  });
});
