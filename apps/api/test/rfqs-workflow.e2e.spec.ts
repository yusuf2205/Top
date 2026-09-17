import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createSystemPrismaClient } from "@top/database";
import { AuditService } from "../src/common/audit/audit.service";
import { createTestApp, uniqueEmail } from "./test-app";

/**
 * M3.3 RFQ Phase C — DRAFT progressive editing, SEND/CLOSE/CANCEL exact
 * transition tables, post-SEND immutability, supplier identity snapshot
 * semantics, and audit/mutation transaction atomicity, all over real HTTP
 * against real Postgres.
 */

interface OrgContext {
  email: string;
  accessToken: string;
  userId: string;
  organizationId: string;
}

async function registerOrg(app: INestApplication, orgName: string): Promise<OrgContext> {
  const email = uniqueEmail("rfqwf");
  const password = "correct-horse-battery-staple";
  const res = await request(app.getHttpServer())
    .post("/api/v1/auth/register")
    .send({ organizationName: orgName, fullName: "Admin", email, password });
  return {
    email,
    accessToken: res.body.accessToken as string,
    userId: res.body.user.id as string,
    organizationId: res.body.user.organizationId as string,
  };
}

function authed(app: INestApplication, token: string) {
  return {
    get: (url: string) => request(app.getHttpServer()).get(url).set("Authorization", `Bearer ${token}`),
    post: (url: string) => request(app.getHttpServer()).post(url).set("Authorization", `Bearer ${token}`),
    patch: (url: string) => request(app.getHttpServer()).patch(url).set("Authorization", `Bearer ${token}`),
    delete: (url: string) => request(app.getHttpServer()).delete(url).set("Authorization", `Bearer ${token}`),
  };
}

const freeTextItem = { itemName: "Steel pipe DN50", quantity: "20.000", uomCode: "M" };
const futureDeadline = () => new Date(Date.now() + 7 * 86400000).toISOString();

async function postPROk(app: INestApplication, token: string, items: Record<string, unknown>[] = [freeTextItem]) {
  const res = await authed(app, token).post("/api/v1/purchase-requests").send({ items });
  if (res.status !== 201) throw new Error(`postPR failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string; requestNumber: string; items: Array<{ id: string }> };
}

async function createApprovedPR(
  app: INestApplication,
  admin: OrgContext,
  items: Record<string, unknown>[] = [freeTextItem, { ...freeTextItem, itemName: "Second Item" }]
) {
  const pr = await postPROk(app, admin.accessToken, items);
  await authed(app, admin.accessToken).post(`/api/v1/purchase-requests/${pr.id}/submit`);
  const approve = await authed(app, admin.accessToken).post(`/api/v1/purchase-requests/${pr.id}/approve`);
  if (approve.status !== 200) throw new Error(`approve failed: ${approve.status} ${JSON.stringify(approve.body)}`);
  return pr;
}

async function createSupplierActive(app: INestApplication, token: string, companyName = "Test Supplier") {
  const res = await authed(app, token).post("/api/v1/suppliers").send({ companyName });
  if (res.status !== 201) throw new Error(`createSupplier failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string; supplierCode: string; companyName: string };
}

async function createRfqOk(app: INestApplication, token: string, body: Record<string, unknown>) {
  const res = await authed(app, token).post("/api/v1/rfqs").send(body);
  if (res.status !== 201) throw new Error(`createRfq failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as Record<string, unknown> & { id: string; rfqNumber: string };
}

/** Builds a fully SEND-ready DRAFT RFQ (>=1 item, >=1 ACTIVE supplier, future deadline) and returns it plus its raw ingredients. */
async function buildSendableDraft(app: INestApplication, admin: OrgContext) {
  const pr = await createApprovedPR(app, admin, [freeTextItem]);
  const supplier = await createSupplierActive(app, admin.accessToken);
  const rfq = await createRfqOk(app, admin.accessToken, {
    purchaseRequestId: pr.id,
    purchaseRequestItemIds: [pr.items[0]!.id],
    supplierIds: [supplier.id],
    deadline: futureDeadline(),
  });
  return { pr, supplier, rfq };
}

describe("M3.3 RFQ — workflow (DRAFT editing / send / close / cancel / immutability / audit)", () => {
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
  // DRAFT HEADER PATCH
  // ────────────────────────────────────────────────────────────

  describe("DRAFT header PATCH", () => {
    it("updates deadline/supplierInstructions/internalNotes, supports null-clearing, and no-ops without an audit row", async () => {
      const admin = await registerOrg(app, "Header Patch Org");
      const pr = await postPROk(app, admin.accessToken);
      await authed(app, admin.accessToken).post(`/api/v1/purchase-requests/${pr.id}/submit`);
      await authed(app, admin.accessToken).post(`/api/v1/purchase-requests/${pr.id}/approve`);
      const rfq = await createRfqOk(app, admin.accessToken, { purchaseRequestId: pr.id, supplierInstructions: "Ship to warehouse A" });

      const updated = await authed(app, admin.accessToken).patch(`/api/v1/rfqs/${rfq.id}`).send({ internalNotes: "internal only" });
      expect(updated.status).toBe(200);
      expect(updated.body.internalNotes).toBe("internal only");

      const cleared = await authed(app, admin.accessToken).patch(`/api/v1/rfqs/${rfq.id}`).send({ supplierInstructions: null });
      expect(cleared.status).toBe(200);
      expect(cleared.body.supplierInstructions).toBeNull();

      const countBefore = await db.auditLog.count({ where: { entityId: rfq.id, action: "RFQ_UPDATED" } });
      const noop = await authed(app, admin.accessToken).patch(`/api/v1/rfqs/${rfq.id}`).send({ internalNotes: "internal only" });
      expect(noop.status).toBe(200);
      const countAfter = await db.auditLog.count({ where: { entityId: rfq.id, action: "RFQ_UPDATED" } });
      expect(countAfter).toBe(countBefore);
    });

    it("rejects an empty PATCH body (400)", async () => {
      const admin = await registerOrg(app, "Empty Patch Org");
      const pr = await createApprovedPR(app, admin);
      const rfq = await createRfqOk(app, admin.accessToken, { purchaseRequestId: pr.id });
      const res = await authed(app, admin.accessToken).patch(`/api/v1/rfqs/${rfq.id}`).send({});
      expect(res.status).toBe(400);
    });

    it("PATCH does not require a future deadline (only SEND does)", async () => {
      const admin = await registerOrg(app, "Past Deadline Patch Org");
      const pr = await createApprovedPR(app, admin);
      const rfq = await createRfqOk(app, admin.accessToken, { purchaseRequestId: pr.id });
      const res = await authed(app, admin.accessToken).patch(`/api/v1/rfqs/${rfq.id}`).send({ deadline: new Date(Date.now() - 86400000).toISOString() });
      expect(res.status).toBe(200);
    });
  });

  // ────────────────────────────────────────────────────────────
  // DRAFT ITEM ADD/REMOVE
  // ────────────────────────────────────────────────────────────

  describe("DRAFT item add/remove", () => {
    it("adds and removes an item, rejecting a duplicate add with a clean 409", async () => {
      const admin = await registerOrg(app, "Item Add Remove Org");
      const pr = await createApprovedPR(app, admin, [freeTextItem]);
      const rfq = await createRfqOk(app, admin.accessToken, { purchaseRequestId: pr.id });

      const add = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/items`).send({ purchaseRequestItemId: pr.items[0]!.id });
      expect(add.status).toBe(201);

      const dup = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/items`).send({ purchaseRequestItemId: pr.items[0]!.id });
      expect(dup.status).toBe(409);

      const remove = await authed(app, admin.accessToken).delete(`/api/v1/rfqs/${rfq.id}/items/${add.body.id}`);
      expect(remove.status).toBe(200);

      const detail = await authed(app, admin.accessToken).get(`/api/v1/rfqs/${rfq.id}`);
      expect(detail.body.items).toHaveLength(0);
    });

    it("DRAFT may become empty again (no minimum-one-item rule)", async () => {
      const admin = await registerOrg(app, "Empty Again Org");
      const pr = await createApprovedPR(app, admin, [freeTextItem]);
      const rfq = await createRfqOk(app, admin.accessToken, { purchaseRequestId: pr.id, purchaseRequestItemIds: [pr.items[0]!.id] });
      const detail = await authed(app, admin.accessToken).get(`/api/v1/rfqs/${rfq.id}`);
      const remove = await authed(app, admin.accessToken).delete(`/api/v1/rfqs/${rfq.id}/items/${detail.body.items[0].id}`);
      expect(remove.status).toBe(200);
    });

    it("removing a nonexistent RFQ item id is 404", async () => {
      const admin = await registerOrg(app, "Missing Item Org");
      const pr = await createApprovedPR(app, admin);
      const rfq = await createRfqOk(app, admin.accessToken, { purchaseRequestId: pr.id });
      const res = await authed(app, admin.accessToken).delete(`/api/v1/rfqs/${rfq.id}/items/00000000-0000-0000-0000-000000000000`);
      expect(res.status).toBe(404);
    });
  });

  // ────────────────────────────────────────────────────────────
  // DRAFT SUPPLIER ADD/REMOVE
  // ────────────────────────────────────────────────────────────

  describe("DRAFT supplier add/remove", () => {
    it("adds and removes a supplier, rejecting a duplicate add with a clean 409", async () => {
      const admin = await registerOrg(app, "Supplier Add Remove Org");
      const pr = await createApprovedPR(app, admin);
      const supplier = await createSupplierActive(app, admin.accessToken);
      const rfq = await createRfqOk(app, admin.accessToken, { purchaseRequestId: pr.id });

      const add = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers`).send({ supplierId: supplier.id });
      expect(add.status).toBe(201);
      expect(add.body.status).toBe("SELECTED");

      const dup = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers`).send({ supplierId: supplier.id });
      expect(dup.status).toBe(409);

      const remove = await authed(app, admin.accessToken).delete(`/api/v1/rfqs/${rfq.id}/suppliers/${add.body.id}`);
      expect(remove.status).toBe(200);
    });

    it("rejects adding a non-ACTIVE supplier (400)", async () => {
      const admin = await registerOrg(app, "Inactive Add Org");
      const pr = await createApprovedPR(app, admin);
      const supplier = await createSupplierActive(app, admin.accessToken);
      await authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}/status`).send({ status: "INACTIVE" });
      const rfq = await createRfqOk(app, admin.accessToken, { purchaseRequestId: pr.id });
      const res = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers`).send({ supplierId: supplier.id });
      expect(res.status).toBe(400);
    });
  });

  // ────────────────────────────────────────────────────────────
  // SEND — preconditions
  // ────────────────────────────────────────────────────────────

  describe("SEND preconditions", () => {
    it("400s with 0 items", async () => {
      const admin = await registerOrg(app, "Send NoItems Org");
      const pr = await createApprovedPR(app, admin);
      const supplier = await createSupplierActive(app, admin.accessToken);
      const rfq = await createRfqOk(app, admin.accessToken, { purchaseRequestId: pr.id, supplierIds: [supplier.id], deadline: futureDeadline() });
      const res = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/send`);
      expect(res.status).toBe(400);
    });

    it("400s with 0 suppliers", async () => {
      const admin = await registerOrg(app, "Send NoSuppliers Org");
      const pr = await createApprovedPR(app, admin, [freeTextItem]);
      const rfq = await createRfqOk(app, admin.accessToken, { purchaseRequestId: pr.id, purchaseRequestItemIds: [pr.items[0]!.id], deadline: futureDeadline() });
      const res = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/send`);
      expect(res.status).toBe(400);
    });

    it("400s with a null deadline", async () => {
      const admin = await registerOrg(app, "Send NullDeadline Org");
      const pr = await createApprovedPR(app, admin, [freeTextItem]);
      const supplier = await createSupplierActive(app, admin.accessToken);
      const rfq = await createRfqOk(app, admin.accessToken, {
        purchaseRequestId: pr.id,
        purchaseRequestItemIds: [pr.items[0]!.id],
        supplierIds: [supplier.id],
      });
      const res = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/send`);
      expect(res.status).toBe(400);
    });

    it("400s with a past deadline", async () => {
      const admin = await registerOrg(app, "Send PastDeadline Org");
      const pr = await createApprovedPR(app, admin, [freeTextItem]);
      const supplier = await createSupplierActive(app, admin.accessToken);
      const rfq = await createRfqOk(app, admin.accessToken, {
        purchaseRequestId: pr.id,
        purchaseRequestItemIds: [pr.items[0]!.id],
        supplierIds: [supplier.id],
      });
      await authed(app, admin.accessToken).patch(`/api/v1/rfqs/${rfq.id}`).send({ deadline: new Date(Date.now() - 3600000).toISOString() });
      const res = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/send`);
      expect(res.status).toBe(400);
    });

    it("400s when a selected supplier is BLOCKED/INACTIVE/ARCHIVED, and the RFQ stays DRAFT with no partial side effects", async () => {
      const admin = await registerOrg(app, "Send InactiveSupplier Org");
      const { rfq, supplier } = await buildSendableDraft(app, admin);
      await authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}/status`).send({ status: "BLOCKED" });

      const res = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/send`);
      expect(res.status).toBe(400);

      const after = await authed(app, admin.accessToken).get(`/api/v1/rfqs/${rfq.id}`);
      expect(after.body.status).toBe("DRAFT");
      expect(after.body.sentAt).toBeNull();
      const sendAudits = await db.auditLog.count({ where: { entityId: rfq.id, action: "RFQ_SENT" } });
      expect(sendAudits).toBe(0);
    });
  });

  // ────────────────────────────────────────────────────────────
  // SEND — success / PR transition / repeat / post-SEND immutability
  // ────────────────────────────────────────────────────────────

  describe("SEND success and repeat", () => {
    it("transitions DRAFT -> SENT, transitions the source PR APPROVED -> RFQ_IN_PROGRESS, and writes both audits", async () => {
      const admin = await registerOrg(app, "Send Success Org");
      const { pr, rfq } = await buildSendableDraft(app, admin);

      const res = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/send`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("SENT");
      expect(res.body.sentAt).not.toBeNull();

      const prAfter = await authed(app, admin.accessToken).get(`/api/v1/purchase-requests/${pr.id}`);
      expect(prAfter.body.status).toBe("RFQ_IN_PROGRESS");

      const sentAudit = await db.auditLog.count({ where: { entityId: rfq.id, action: "RFQ_SENT" } });
      expect(sentAudit).toBe(1);
      const prAudit = await db.auditLog.count({ where: { entityId: pr.id, action: "PURCHASE_REQUEST_RFQ_STARTED" } });
      expect(prAudit).toBe(1);
    });

    it("a second RFQ send when the PR is already RFQ_IN_PROGRESS leaves the PR unchanged and writes no second PURCHASE_REQUEST_RFQ_STARTED", async () => {
      const admin = await registerOrg(app, "Second RFQ Send Org");
      const pr = await createApprovedPR(app, admin, [freeTextItem, { ...freeTextItem, itemName: "B" }]);
      const supplier = await createSupplierActive(app, admin.accessToken);
      const first = await createRfqOk(app, admin.accessToken, {
        purchaseRequestId: pr.id,
        purchaseRequestItemIds: [pr.items[0]!.id],
        supplierIds: [supplier.id],
        deadline: futureDeadline(),
      });
      await authed(app, admin.accessToken).post(`/api/v1/rfqs/${first.id}/send`);

      const second = await createRfqOk(app, admin.accessToken, {
        purchaseRequestId: pr.id,
        purchaseRequestItemIds: [pr.items[1]!.id],
        supplierIds: [supplier.id],
        deadline: futureDeadline(),
      });
      const sendSecond = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${second.id}/send`);
      expect(sendSecond.status).toBe(200);

      const prAfter = await authed(app, admin.accessToken).get(`/api/v1/purchase-requests/${pr.id}`);
      expect(prAfter.body.status).toBe("RFQ_IN_PROGRESS");
      const prAuditCount = await db.auditLog.count({ where: { entityId: pr.id, action: "PURCHASE_REQUEST_RFQ_STARTED" } });
      expect(prAuditCount).toBe(1);
    });

    it("repeat send on an already-SENT RFQ returns 200 with no duplicate audit and no PR re-transition", async () => {
      const admin = await registerOrg(app, "Repeat Send Org");
      const { rfq } = await buildSendableDraft(app, admin);
      await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/send`);

      const countBefore = await db.auditLog.count({ where: { entityId: rfq.id, action: "RFQ_SENT" } });
      const repeat = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/send`);
      expect(repeat.status).toBe(200);
      expect(repeat.body.status).toBe("SENT");
      const countAfter = await db.auditLog.count({ where: { entityId: rfq.id, action: "RFQ_SENT" } });
      expect(countAfter).toBe(countBefore);
    });

    it("send from CLOSED/CANCELLED is 409", async () => {
      const admin = await registerOrg(app, "Send From Terminal Org");
      const draft1 = await buildSendableDraft(app, admin);
      await authed(app, admin.accessToken).post(`/api/v1/rfqs/${draft1.rfq.id}/send`);
      await authed(app, admin.accessToken).post(`/api/v1/rfqs/${draft1.rfq.id}/close`);
      const sendClosed = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${draft1.rfq.id}/send`);
      expect(sendClosed.status).toBe(409);

      const pr2 = await createApprovedPR(app, admin);
      const rfq2 = await createRfqOk(app, admin.accessToken, { purchaseRequestId: pr2.id });
      await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq2.id}/cancel`);
      const sendCancelled = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq2.id}/send`);
      expect(sendCancelled.status).toBe(409);
    });

    it("post-SEND: header PATCH, item add/remove, supplier add/remove all return 409", async () => {
      const admin = await registerOrg(app, "Post Send Immutability Org");
      const { rfq, pr } = await buildSendableDraft(app, admin);
      const detailBefore = await authed(app, admin.accessToken).get(`/api/v1/rfqs/${rfq.id}`);
      const existingItemId = detailBefore.body.items[0].id as string;
      const existingSupplierId = detailBefore.body.suppliers[0].id as string;
      await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/send`);

      const anotherPrItem = (await postPROk(app, admin.accessToken)).items[0]!.id;
      const anotherSupplier = await createSupplierActive(app, admin.accessToken, "Another Co");

      expect((await authed(app, admin.accessToken).patch(`/api/v1/rfqs/${rfq.id}`).send({ internalNotes: "x" })).status).toBe(409);
      expect((await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/items`).send({ purchaseRequestItemId: anotherPrItem })).status).toBe(409);
      expect((await authed(app, admin.accessToken).delete(`/api/v1/rfqs/${rfq.id}/items/${existingItemId}`)).status).toBe(409);
      expect((await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers`).send({ supplierId: anotherSupplier.id })).status).toBe(409);
      expect((await authed(app, admin.accessToken).delete(`/api/v1/rfqs/${rfq.id}/suppliers/${existingSupplierId}`)).status).toBe(409);

      // Detail/list stay readable.
      expect((await authed(app, admin.accessToken).get(`/api/v1/rfqs/${rfq.id}`)).status).toBe(200);
      expect((await authed(app, admin.accessToken).get("/api/v1/rfqs")).status).toBe(200);
      void pr;
    });
  });

  // ────────────────────────────────────────────────────────────
  // SNAPSHOT SEMANTICS
  // ────────────────────────────────────────────────────────────

  describe("supplier snapshot semantics", () => {
    it("refreshes the supplier snapshot at SEND time, then freezes it forever after", async () => {
      const admin = await registerOrg(app, "Snapshot Semantics Org");
      const pr = await createApprovedPR(app, admin, [freeTextItem]);
      const supplier = await createSupplierActive(app, admin.accessToken, "Name At Add Time");
      const rfq = await createRfqOk(app, admin.accessToken, {
        purchaseRequestId: pr.id,
        purchaseRequestItemIds: [pr.items[0]!.id],
        supplierIds: [supplier.id],
        deadline: futureDeadline(),
      });
      const detailAfterAdd = await authed(app, admin.accessToken).get(`/api/v1/rfqs/${rfq.id}`);
      expect(detailAfterAdd.body.suppliers[0].companyNameSnapshot).toBe("Name At Add Time");

      // Rename before SEND — SEND must refresh the snapshot to the renamed value.
      await authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}`).send({ companyName: "Name Before Send" });
      const sendRes = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/send`);
      expect(sendRes.status).toBe(200);
      expect(sendRes.body.suppliers[0].companyNameSnapshot).toBe("Name Before Send");

      // Rename after SEND — RFQ snapshot must remain unchanged.
      await authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}`).send({ companyName: "Name After Send" });
      const detailAfterSend = await authed(app, admin.accessToken).get(`/api/v1/rfqs/${rfq.id}`);
      expect(detailAfterSend.body.suppliers[0].companyNameSnapshot).toBe("Name Before Send");
      // currentSupplierStatus/the live relation is NOT frozen — this is the Supplier's live status.
      expect(detailAfterSend.body.suppliers[0].currentSupplierStatus).toBe("ACTIVE");
    });

    it("SEND refreshes ONLY supplierCodeSnapshot/companyNameSnapshot — portal fields (portalTokenHash/tokenExpiresAt/invitedAt/status) are untouched, at the DB row level", async () => {
      const admin = await registerOrg(app, "Portal Field Isolation Org");
      const { rfq, supplier } = await buildSendableDraft(app, admin);

      const rfqSupplierBefore = await db.rFQSupplier.findFirstOrThrow({ where: { rfqId: rfq.id, supplierId: supplier.id } });
      expect(rfqSupplierBefore.portalTokenHash).toBeNull();
      expect(rfqSupplierBefore.tokenExpiresAt).toBeNull();
      expect(rfqSupplierBefore.invitedAt).toBeNull();
      expect(rfqSupplierBefore.status).toBe("SELECTED");

      const sendRes = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/send`);
      expect(sendRes.status).toBe(200);

      const rfqSupplierAfter = await db.rFQSupplier.findUniqueOrThrow({ where: { id: rfqSupplierBefore.id } });
      expect(rfqSupplierAfter.portalTokenHash).toBeNull();
      expect(rfqSupplierAfter.tokenExpiresAt).toBeNull();
      expect(rfqSupplierAfter.invitedAt).toBeNull();
      expect(rfqSupplierAfter.status).toBe("SELECTED");
    });
  });

  // ────────────────────────────────────────────────────────────
  // CLOSE — exact transition table
  // ────────────────────────────────────────────────────────────

  describe("CLOSE", () => {
    it("SENT -> CLOSED writes an audit; repeat CLOSE is a 200 no-op with no duplicate audit", async () => {
      const admin = await registerOrg(app, "Close Org");
      const { rfq } = await buildSendableDraft(app, admin);
      await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/send`);

      const close = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/close`).send({ reason: "no longer needed" });
      expect(close.status).toBe(200);
      expect(close.body.status).toBe("CLOSED");
      expect(close.body.closedAt).not.toBeNull();

      const countBefore = await db.auditLog.count({ where: { entityId: rfq.id, action: "RFQ_CLOSED" } });
      const repeat = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/close`);
      expect(repeat.status).toBe(200);
      const countAfter = await db.auditLog.count({ where: { entityId: rfq.id, action: "RFQ_CLOSED" } });
      expect(countAfter).toBe(countBefore);
    });

    it("DRAFT/CANCELLED -> CLOSE is 409, and CLOSE never mutates the source PR", async () => {
      const admin = await registerOrg(app, "Close Invalid Org");
      const pr1 = await createApprovedPR(app, admin);
      const draftRfq = await createRfqOk(app, admin.accessToken, { purchaseRequestId: pr1.id });
      expect((await authed(app, admin.accessToken).post(`/api/v1/rfqs/${draftRfq.id}/close`)).status).toBe(409);

      const pr2 = await createApprovedPR(app, admin);
      const cancelledRfq = await createRfqOk(app, admin.accessToken, { purchaseRequestId: pr2.id });
      await authed(app, admin.accessToken).post(`/api/v1/rfqs/${cancelledRfq.id}/cancel`);
      expect((await authed(app, admin.accessToken).post(`/api/v1/rfqs/${cancelledRfq.id}/close`)).status).toBe(409);
    });

    it("close does not persist a closeReason column — reason is audit-only", async () => {
      const admin = await registerOrg(app, "Close Reason Audit Only Org");
      const { rfq } = await buildSendableDraft(app, admin);
      await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/send`);
      const close = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/close`).send({ reason: "budget cut" });
      expect(close.status).toBe(200);
      expect(close.body).not.toHaveProperty("closeReason");
    });
  });

  // ────────────────────────────────────────────────────────────
  // CANCEL — exact transition table
  // ────────────────────────────────────────────────────────────

  describe("CANCEL", () => {
    it("DRAFT -> CANCELLED and SENT -> CANCELLED both write an audit and persist cancelReason", async () => {
      const admin = await registerOrg(app, "Cancel Org");
      const pr1 = await createApprovedPR(app, admin);
      const draftRfq = await createRfqOk(app, admin.accessToken, { purchaseRequestId: pr1.id });
      const cancelDraft = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${draftRfq.id}/cancel`).send({ reason: "duplicate" });
      expect(cancelDraft.status).toBe(200);
      expect(cancelDraft.body.status).toBe("CANCELLED");
      expect(cancelDraft.body.cancelReason).toBe("duplicate");

      const { rfq: sentRfq } = await buildSendableDraft(app, admin);
      await authed(app, admin.accessToken).post(`/api/v1/rfqs/${sentRfq.id}/send`);
      const cancelSent = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${sentRfq.id}/cancel`);
      expect(cancelSent.status).toBe(200);
      expect(cancelSent.body.cancelReason).toBeNull();
    });

    it("repeat cancel is a 200 no-op and never overwrites the already-persisted cancelReason", async () => {
      const admin = await registerOrg(app, "Repeat Cancel Org");
      const pr = await createApprovedPR(app, admin);
      const rfq = await createRfqOk(app, admin.accessToken, { purchaseRequestId: pr.id });
      await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/cancel`).send({ reason: "original reason" });

      const countBefore = await db.auditLog.count({ where: { entityId: rfq.id, action: "RFQ_CANCELLED" } });
      const repeat = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/cancel`).send({ reason: "different reason" });
      expect(repeat.status).toBe(200);
      expect(repeat.body.cancelReason).toBe("original reason");
      const countAfter = await db.auditLog.count({ where: { entityId: rfq.id, action: "RFQ_CANCELLED" } });
      expect(countAfter).toBe(countBefore);
    });

    it("CLOSED -> CANCEL is 409, and cancel never rolls back the PR transition", async () => {
      const admin = await registerOrg(app, "Cancel Invalid Org");
      const { rfq, pr } = await buildSendableDraft(app, admin);
      await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/send`);
      await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/close`);
      expect((await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/cancel`)).status).toBe(409);

      // Separately: cancelling a SENT RFQ must NOT revert the PR back from RFQ_IN_PROGRESS.
      const pr2 = await createApprovedPR(app, admin, [freeTextItem]);
      const supplier2 = await createSupplierActive(app, admin.accessToken);
      const rfq2 = await createRfqOk(app, admin.accessToken, {
        purchaseRequestId: pr2.id,
        purchaseRequestItemIds: [pr2.items[0]!.id],
        supplierIds: [supplier2.id],
        deadline: futureDeadline(),
      });
      await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq2.id}/send`);
      await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq2.id}/cancel`);
      const prAfter = await authed(app, admin.accessToken).get(`/api/v1/purchase-requests/${pr2.id}`);
      expect(prAfter.body.status).toBe("RFQ_IN_PROGRESS");
      void pr;
    });
  });

  // ────────────────────────────────────────────────────────────
  // AUDIT / MUTATION TRANSACTION ATOMICITY
  // ────────────────────────────────────────────────────────────

  describe("audit rollback (mutation + audit atomicity)", () => {
    it("create() rolls back the whole RFQ (header + items + suppliers) if AuditLog write fails", async () => {
      const admin = await registerOrg(app, "Create Atomicity Org");
      const pr = await createApprovedPR(app, admin, [freeTextItem]);
      const supplier = await createSupplierActive(app, admin.accessToken);

      const spy = jest.spyOn(audit, "log").mockRejectedValueOnce(new Error("simulated audit failure"));
      try {
        const res = await authed(app, admin.accessToken)
          .post("/api/v1/rfqs")
          .send({ purchaseRequestId: pr.id, purchaseRequestItemIds: [pr.items[0]!.id], supplierIds: [supplier.id] });
        expect(res.status).toBe(500);
      } finally {
        spy.mockRestore();
      }

      const rfqCount = await db.rFQ.count({ where: { purchaseRequestId: pr.id } });
      expect(rfqCount).toBe(0);
    });

    it("update() rolls back the header field change if AuditLog write fails", async () => {
      const admin = await registerOrg(app, "Update Atomicity Org");
      const pr = await createApprovedPR(app, admin);
      const rfq = await createRfqOk(app, admin.accessToken, { purchaseRequestId: pr.id, internalNotes: "before" });

      const spy = jest.spyOn(audit, "log").mockRejectedValueOnce(new Error("simulated audit failure"));
      try {
        const res = await authed(app, admin.accessToken).patch(`/api/v1/rfqs/${rfq.id}`).send({ internalNotes: "after" });
        expect(res.status).toBe(500);
      } finally {
        spy.mockRestore();
      }

      const row = await db.rFQ.findUnique({ where: { id: rfq.id } });
      expect(row?.internalNotes).toBe("before");
    });

    it("addItem()/removeItem() roll back if AuditLog write fails", async () => {
      const admin = await registerOrg(app, "Item Atomicity Org");
      const pr = await createApprovedPR(app, admin, [freeTextItem]);
      const rfq = await createRfqOk(app, admin.accessToken, { purchaseRequestId: pr.id });

      const addSpy = jest.spyOn(audit, "log").mockRejectedValueOnce(new Error("simulated audit failure"));
      try {
        const res = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/items`).send({ purchaseRequestItemId: pr.items[0]!.id });
        expect(res.status).toBe(500);
      } finally {
        addSpy.mockRestore();
      }
      expect(await db.rFQItem.count({ where: { rfqId: rfq.id } })).toBe(0);

      const added = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/items`).send({ purchaseRequestItemId: pr.items[0]!.id });
      const removeSpy = jest.spyOn(audit, "log").mockRejectedValueOnce(new Error("simulated audit failure"));
      try {
        const res = await authed(app, admin.accessToken).delete(`/api/v1/rfqs/${rfq.id}/items/${added.body.id}`);
        expect(res.status).toBe(500);
      } finally {
        removeSpy.mockRestore();
      }
      expect(await db.rFQItem.count({ where: { rfqId: rfq.id } })).toBe(1);
    });

    it("addSupplier()/removeSupplier() roll back if AuditLog write fails", async () => {
      const admin = await registerOrg(app, "Supplier Atomicity Org");
      const pr = await createApprovedPR(app, admin);
      const supplier = await createSupplierActive(app, admin.accessToken);
      const rfq = await createRfqOk(app, admin.accessToken, { purchaseRequestId: pr.id });

      const addSpy = jest.spyOn(audit, "log").mockRejectedValueOnce(new Error("simulated audit failure"));
      try {
        const res = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers`).send({ supplierId: supplier.id });
        expect(res.status).toBe(500);
      } finally {
        addSpy.mockRestore();
      }
      expect(await db.rFQSupplier.count({ where: { rfqId: rfq.id } })).toBe(0);

      const added = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers`).send({ supplierId: supplier.id });
      const removeSpy = jest.spyOn(audit, "log").mockRejectedValueOnce(new Error("simulated audit failure"));
      try {
        const res = await authed(app, admin.accessToken).delete(`/api/v1/rfqs/${rfq.id}/suppliers/${added.body.id}`);
        expect(res.status).toBe(500);
      } finally {
        removeSpy.mockRestore();
      }
      expect(await db.rFQSupplier.count({ where: { rfqId: rfq.id } })).toBe(1);
    });

    it("send() rolls back BOTH the RFQ status and the PR transition (and leaves no partial snapshot refresh) if AuditLog write fails", async () => {
      const admin = await registerOrg(app, "Send Atomicity Org");
      const { rfq, pr, supplier } = await buildSendableDraft(app, admin);
      await authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}`).send({ companyName: "Renamed Before Send Attempt" });

      const spy = jest.spyOn(audit, "log").mockRejectedValueOnce(new Error("simulated audit failure"));
      try {
        const res = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/send`);
        expect(res.status).toBe(500);
      } finally {
        spy.mockRestore();
      }

      const rfqRow = await db.rFQ.findUnique({ where: { id: rfq.id } });
      expect(rfqRow?.status).toBe("DRAFT");
      expect(rfqRow?.sentAt).toBeNull();
      const prRow = await db.purchaseRequest.findUnique({ where: { id: pr.id } });
      expect(prRow?.status).toBe("APPROVED");
      const rfqSupplierRow = await db.rFQSupplier.findFirst({ where: { rfqId: rfq.id } });
      expect(rfqSupplierRow?.companyNameSnapshot).not.toBe("Renamed Before Send Attempt");
      const sentAudits = await db.auditLog.count({ where: { entityId: rfq.id, action: "RFQ_SENT" } });
      expect(sentAudits).toBe(0);
    });

    it("send() rolls back EVERYTHING (including the already-written RFQ_SENT audit row) if the SECOND audit write (PURCHASE_REQUEST_RFQ_STARTED) fails", async () => {
      const admin = await registerOrg(app, "Send Second Audit Atomicity Org");
      const { rfq, pr, supplier } = await buildSendableDraft(app, admin);
      await authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}`).send({ companyName: "Renamed Before Second-Audit-Failure Send" });

      const originalLog = audit.log.bind(audit);
      let callCount = 0;
      const spy = jest.spyOn(audit, "log").mockImplementation(async (...args) => {
        callCount += 1;
        if (callCount === 2) throw new Error("simulated second audit failure");
        return originalLog(...args);
      });
      try {
        const res = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/send`);
        expect(res.status).toBe(500);
      } finally {
        spy.mockRestore();
      }
      expect(callCount).toBe(2); // proves the first (RFQ_SENT) audit call really was reached before the forced second failure

      const rfqRow = await db.rFQ.findUnique({ where: { id: rfq.id } });
      expect(rfqRow?.status).toBe("DRAFT");
      expect(rfqRow?.sentAt).toBeNull();
      const prRow = await db.purchaseRequest.findUnique({ where: { id: pr.id } });
      expect(prRow?.status).toBe("APPROVED");
      const rfqSupplierRow = await db.rFQSupplier.findFirst({ where: { rfqId: rfq.id } });
      expect(rfqSupplierRow?.companyNameSnapshot).not.toBe("Renamed Before Second-Audit-Failure Send");
      // The first audit call's own DB write must also be rolled back — it shared the same transaction.
      const sentAudits = await db.auditLog.count({ where: { entityId: rfq.id, action: "RFQ_SENT" } });
      expect(sentAudits).toBe(0);
      const startedAudits = await db.auditLog.count({ where: { entityId: pr.id, action: "PURCHASE_REQUEST_RFQ_STARTED" } });
      expect(startedAudits).toBe(0);
    });

    it("close() and cancel() roll back if AuditLog write fails", async () => {
      const admin = await registerOrg(app, "Close Cancel Atomicity Org");
      const { rfq: rfqForClose } = await buildSendableDraft(app, admin);
      await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfqForClose.id}/send`);
      const closeSpy = jest.spyOn(audit, "log").mockRejectedValueOnce(new Error("simulated audit failure"));
      try {
        const res = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfqForClose.id}/close`);
        expect(res.status).toBe(500);
      } finally {
        closeSpy.mockRestore();
      }
      const closedRow = await db.rFQ.findUnique({ where: { id: rfqForClose.id } });
      expect(closedRow?.status).toBe("SENT");

      const pr2 = await createApprovedPR(app, admin);
      const rfqForCancel = await createRfqOk(app, admin.accessToken, { purchaseRequestId: pr2.id });
      const cancelSpy = jest.spyOn(audit, "log").mockRejectedValueOnce(new Error("simulated audit failure"));
      try {
        const res = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfqForCancel.id}/cancel`);
        expect(res.status).toBe(500);
      } finally {
        cancelSpy.mockRestore();
      }
      const cancelledRow = await db.rFQ.findUnique({ where: { id: rfqForCancel.id } });
      expect(cancelledRow?.status).toBe("DRAFT");
    });
  });
});
