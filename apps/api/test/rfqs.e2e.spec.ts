import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createSystemPrismaClient } from "@top/database";
import { createTestApp, uniqueEmail } from "./test-app";

/**
 * M3.3 RFQ Phase C (Architecture Revision 1, locked). CRUD / RBAC / tenant
 * isolation / create idempotency / list / detail / serialization, all over
 * real HTTP against real Postgres. Workflow (send/close/cancel/immutability/
 * audit rollback) lives in rfqs-workflow.e2e.spec.ts; concurrency races live
 * in rfqs-concurrency.e2e.spec.ts.
 */

interface OrgContext {
  email: string;
  accessToken: string;
  userId: string;
  organizationId: string;
}

async function registerOrg(app: INestApplication, orgName: string): Promise<OrgContext> {
  const email = uniqueEmail("rfq");
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

async function inviteAndLogin(app: INestApplication, admin: OrgContext, role: string): Promise<OrgContext> {
  const email = uniqueEmail(role.toLowerCase());
  const password = "correct-horse-battery-staple";
  const invite = await request(app.getHttpServer())
    .post("/api/v1/members/invitations")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({ email, role });
  await request(app.getHttpServer())
    .post(`/api/v1/invitations/${invite.body.rawToken as string}/accept`)
    .send({ fullName: "Test User", password });
  const login = await request(app.getHttpServer()).post("/api/v1/auth/login").send({ email, password });
  return {
    email,
    accessToken: login.body.accessToken as string,
    userId: login.body.user.id as string,
    organizationId: admin.organizationId,
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

async function postPROk(app: INestApplication, token: string, items: Record<string, unknown>[] = [freeTextItem]) {
  const res = await authed(app, token).post("/api/v1/purchase-requests").send({ items });
  if (res.status !== 201) throw new Error(`postPR failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string; requestNumber: string; items: Array<{ id: string }> };
}

/** Creates a PR (with 2 free-text items by default) and drives it to APPROVED via submit+approve, both as ADMIN. */
async function createApprovedPR(app: INestApplication, admin: OrgContext, items: Record<string, unknown>[] = [freeTextItem, { ...freeTextItem, itemName: "Second Item" }]) {
  const pr = await postPROk(app, admin.accessToken, items);
  const submit = await authed(app, admin.accessToken).post(`/api/v1/purchase-requests/${pr.id}/submit`);
  if (submit.status !== 200) throw new Error(`submit failed: ${submit.status} ${JSON.stringify(submit.body)}`);
  const approve = await authed(app, admin.accessToken).post(`/api/v1/purchase-requests/${pr.id}/approve`);
  if (approve.status !== 200) throw new Error(`approve failed: ${approve.status} ${JSON.stringify(approve.body)}`);
  return pr;
}

async function createSupplierActive(app: INestApplication, token: string, companyName = "Test Supplier") {
  const res = await authed(app, token).post("/api/v1/suppliers").send({ companyName });
  if (res.status !== 201) throw new Error(`createSupplier failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string; supplierCode: string; companyName: string; status: string };
}

async function createRfqOk(app: INestApplication, token: string, body: Record<string, unknown>) {
  const res = await authed(app, token).post("/api/v1/rfqs").send(body);
  if (res.status !== 201) throw new Error(`createRfq failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as Record<string, unknown> & { id: string; rfqNumber: string };
}

describe("M3.3 RFQ — create / list / detail / RBAC / tenant", () => {
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

  // ────────────────────────────────────────────────────────────
  // CREATE — PR eligibility
  // ────────────────────────────────────────────────────────────

  describe("create / PR eligibility", () => {
    it("creates from an APPROVED purchase request", async () => {
      const admin = await registerOrg(app, "Create Approved Org");
      const pr = await createApprovedPR(app, admin);
      const rfq = await createRfqOk(app, admin.accessToken, { purchaseRequestId: pr.id });
      expect(rfq.rfqNumber).toMatch(/^RFQ-\d{4}-\d{6}$/);
      expect(rfq.status).toBe("DRAFT");
    });

    it("creates from an RFQ_IN_PROGRESS purchase request (second RFQ against the same PR)", async () => {
      const admin = await registerOrg(app, "Create RfqInProgress Org");
      const pr = await createApprovedPR(app, admin);
      const supplier = await createSupplierActive(app, admin.accessToken);
      const first = await createRfqOk(app, admin.accessToken, {
        purchaseRequestId: pr.id,
        purchaseRequestItemIds: [pr.items[0]!.id],
        supplierIds: [supplier.id],
        deadline: new Date(Date.now() + 7 * 86400000).toISOString(),
      });
      await authed(app, admin.accessToken).post(`/api/v1/rfqs/${first.id}/send`);

      const second = await authed(app, admin.accessToken).post("/api/v1/rfqs").send({ purchaseRequestId: pr.id });
      expect(second.status).toBe(201);
    });

    it.each(["DRAFT", "SUBMITTED", "UNDER_APPROVAL", "REJECTED", "CANCELLED"])("rejects create from PR status %s with 409", async (targetStatus) => {
      const admin = await registerOrg(app, "Create Ineligible Org");
      const pr = await postPROk(app, admin.accessToken);
      if (targetStatus !== "DRAFT") {
        await authed(app, admin.accessToken).post(`/api/v1/purchase-requests/${pr.id}/submit`);
        if (targetStatus === "REJECTED") {
          await authed(app, admin.accessToken).post(`/api/v1/purchase-requests/${pr.id}/reject`).send({ reason: "no" });
        } else if (targetStatus === "CANCELLED") {
          // UNDER_APPROVAL is not cancellable in M3.1 — cancel a fresh DRAFT instead for this one case.
        }
      }
      if (targetStatus === "CANCELLED") {
        const draftPr = await postPROk(app, admin.accessToken);
        await authed(app, admin.accessToken).post(`/api/v1/purchase-requests/${draftPr.id}/cancel`);
        const res = await authed(app, admin.accessToken).post("/api/v1/rfqs").send({ purchaseRequestId: draftPr.id });
        expect(res.status).toBe(409);
        return;
      }
      const res = await authed(app, admin.accessToken).post("/api/v1/rfqs").send({ purchaseRequestId: pr.id });
      expect(res.status).toBe(409);
    });

    it("cross-org purchaseRequestId is rejected with 404, not 409", async () => {
      const orgA = await registerOrg(app, "Cross PR A");
      const orgB = await registerOrg(app, "Cross PR B");
      const pr = await createApprovedPR(app, orgA);
      const res = await authed(app, orgB.accessToken).post("/api/v1/rfqs").send({ purchaseRequestId: pr.id });
      expect(res.status).toBe(404);
    });
  });

  // ────────────────────────────────────────────────────────────
  // CREATE — items / suppliers
  // ────────────────────────────────────────────────────────────

  describe("create / items and suppliers", () => {
    it("allows an empty DRAFT — no items, no suppliers, null deadline", async () => {
      const admin = await registerOrg(app, "Empty Draft Org");
      const pr = await createApprovedPR(app, admin);
      const rfq = await createRfqOk(app, admin.accessToken, { purchaseRequestId: pr.id });
      expect(rfq.status).toBe("DRAFT");
      const detail = await authed(app, admin.accessToken).get(`/api/v1/rfqs/${rfq.id}`);
      expect(detail.body.items).toHaveLength(0);
      expect(detail.body.suppliers).toHaveLength(0);
      expect(detail.body.deadline).toBeNull();
    });

    it("snapshots item and supplier fields server-side, never trusting client-supplied values", async () => {
      const admin = await registerOrg(app, "Snapshot Org");
      const pr = await createApprovedPR(app, admin, [{ itemName: "Widget", quantity: "5.000", uomCode: "PCS", description: "A widget" }]);
      const supplier = await createSupplierActive(app, admin.accessToken, "Snapshot Supplier Co");
      const rfq = await createRfqOk(app, admin.accessToken, {
        purchaseRequestId: pr.id,
        purchaseRequestItemIds: [pr.items[0]!.id],
        supplierIds: [supplier.id],
      });
      const detail = await authed(app, admin.accessToken).get(`/api/v1/rfqs/${rfq.id}`);
      expect(detail.body.items[0].itemName).toBe("Widget");
      expect(typeof detail.body.items[0].quantity).toBe("string");
      expect(Number(detail.body.items[0].quantity)).toBe(5); // Decimal.toString() strips trailing zeros — compare numerically
      expect(detail.body.items[0].uomCode).toBe("PCS");
      expect(detail.body.suppliers[0].supplierCodeSnapshot).toBe(supplier.supplierCode);
      expect(detail.body.suppliers[0].companyNameSnapshot).toBe("Snapshot Supplier Co");
      expect(detail.body.suppliers[0].status).toBe("SELECTED");
      expect(detail.body.suppliers[0]).not.toHaveProperty("portalTokenHash");
      expect(detail.body.suppliers[0]).not.toHaveProperty("tokenExpiresAt");
      expect(detail.body.suppliers[0].invitedAt).toBeNull();
    });

    it("rejects a purchaseRequestItemId that does not belong to the source PR (404)", async () => {
      const admin = await registerOrg(app, "Foreign Item Org");
      const prA = await createApprovedPR(app, admin);
      const prB = await createApprovedPR(app, admin);
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/rfqs")
        .send({ purchaseRequestId: prA.id, purchaseRequestItemIds: [prB.items[0]!.id] });
      expect(res.status).toBe(404);
    });

    it("rejects a cross-org supplierId (404)", async () => {
      const orgA = await registerOrg(app, "Cross Supplier A");
      const orgB = await registerOrg(app, "Cross Supplier B");
      const pr = await createApprovedPR(app, orgA);
      const foreignSupplier = await createSupplierActive(app, orgB.accessToken);
      const res = await authed(app, orgA.accessToken)
        .post("/api/v1/rfqs")
        .send({ purchaseRequestId: pr.id, supplierIds: [foreignSupplier.id] });
      expect(res.status).toBe(404);
    });

    it("rejects a non-ACTIVE supplier at create with 400", async () => {
      const admin = await registerOrg(app, "Inactive Supplier Create Org");
      const pr = await createApprovedPR(app, admin);
      const supplier = await createSupplierActive(app, admin.accessToken);
      await authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}/status`).send({ status: "BLOCKED" });
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/rfqs")
        .send({ purchaseRequestId: pr.id, supplierIds: [supplier.id] });
      expect(res.status).toBe(400);
    });

    it("does not mutate PR status on create", async () => {
      const admin = await registerOrg(app, "Create No PR Mutate Org");
      const pr = await createApprovedPR(app, admin);
      await createRfqOk(app, admin.accessToken, { purchaseRequestId: pr.id });
      const prAfter = await authed(app, admin.accessToken).get(`/api/v1/purchase-requests/${pr.id}`);
      expect(prAfter.body.status).toBe("APPROVED");
    });

    it("rejects duplicate purchaseRequestItemIds / supplierIds in the request body (400)", async () => {
      const admin = await registerOrg(app, "Dup Array Org");
      const pr = await createApprovedPR(app, admin);
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/rfqs")
        .send({ purchaseRequestId: pr.id, purchaseRequestItemIds: [pr.items[0]!.id, pr.items[0]!.id] });
      expect(res.status).toBe(400);
    });
  });

  // ────────────────────────────────────────────────────────────
  // CREATE IDEMPOTENCY
  // ────────────────────────────────────────────────────────────

  describe("create idempotency", () => {
    it("replays the same RFQ for a repeated idempotencyKey with an identical payload", async () => {
      const admin = await registerOrg(app, "Idem Org");
      const pr = await createApprovedPR(app, admin);
      const key = `idem-${Date.now()}`;
      const first = await createRfqOk(app, admin.accessToken, { purchaseRequestId: pr.id, idempotencyKey: key });
      const second = await createRfqOk(app, admin.accessToken, { purchaseRequestId: pr.id, idempotencyKey: key });
      expect(second.id).toBe(first.id);
    });

    it("rejects reusing an idempotencyKey with a different payload (409)", async () => {
      const admin = await registerOrg(app, "Idem Conflict Org");
      const prA = await createApprovedPR(app, admin);
      const prB = await createApprovedPR(app, admin);
      const key = `idem-conflict-${Date.now()}`;
      await createRfqOk(app, admin.accessToken, { purchaseRequestId: prA.id, idempotencyKey: key });
      const res = await authed(app, admin.accessToken).post("/api/v1/rfqs").send({ purchaseRequestId: prB.id, idempotencyKey: key });
      expect(res.status).toBe(409);
    });

    it("array order (items/suppliers) does not affect the idempotency hash — same key replays, never 409", async () => {
      const admin = await registerOrg(app, "Idem Order Org");
      const pr = await createApprovedPR(app, admin, [freeTextItem, { ...freeTextItem, itemName: "B" }]);
      const supplierX = await createSupplierActive(app, admin.accessToken, "X Co");
      const supplierY = await createSupplierActive(app, admin.accessToken, "Y Co");
      const key = `idem-order-${Date.now()}`;
      const itemIds = pr.items.map((i) => i.id);

      const first = await createRfqOk(app, admin.accessToken, {
        purchaseRequestId: pr.id,
        purchaseRequestItemIds: itemIds,
        supplierIds: [supplierX.id, supplierY.id],
        idempotencyKey: key,
      });
      const second = await authed(app, admin.accessToken)
        .post("/api/v1/rfqs")
        .send({
          purchaseRequestId: pr.id,
          purchaseRequestItemIds: [...itemIds].reverse(),
          supplierIds: [supplierY.id, supplierX.id],
          idempotencyKey: key,
        });
      expect(second.status).toBe(201);
      expect(second.body.id).toBe(first.id);
    });

    it("a changed business set with the same key still 409s", async () => {
      const admin = await registerOrg(app, "Idem Real Change Org");
      const pr = await createApprovedPR(app, admin, [freeTextItem, { ...freeTextItem, itemName: "B" }]);
      const key = `idem-real-change-${Date.now()}`;
      await createRfqOk(app, admin.accessToken, { purchaseRequestId: pr.id, purchaseRequestItemIds: [pr.items[0]!.id], idempotencyKey: key });
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/rfqs")
        .send({ purchaseRequestId: pr.id, purchaseRequestItemIds: [pr.items[1]!.id], idempotencyKey: key });
      expect(res.status).toBe(409);
    });

    it("different organizations may reuse the identical idempotencyKey independently", async () => {
      const orgA = await registerOrg(app, "Idem Cross A");
      const orgB = await registerOrg(app, "Idem Cross B");
      const prA = await createApprovedPR(app, orgA);
      const prB = await createApprovedPR(app, orgB);
      const key = `idem-cross-${Date.now()}`;
      const a = await createRfqOk(app, orgA.accessToken, { purchaseRequestId: prA.id, idempotencyKey: key });
      const b = await createRfqOk(app, orgB.accessToken, { purchaseRequestId: prB.id, idempotencyKey: key });
      expect(a.id).not.toBe(b.id);
    });

    it("never exposes idempotencyKey/payloadHash in the response", async () => {
      const admin = await registerOrg(app, "Idem Expose Org");
      const pr = await createApprovedPR(app, admin);
      const rfq = await createRfqOk(app, admin.accessToken, { purchaseRequestId: pr.id, idempotencyKey: `hide-${Date.now()}` });
      expect(rfq).not.toHaveProperty("idempotencyKey");
      expect(rfq).not.toHaveProperty("payloadHash");
    });
  });

  // ────────────────────────────────────────────────────────────
  // LIST
  // ────────────────────────────────────────────────────────────

  describe("list", () => {
    it("filters by status and purchaseRequestId, and includes itemCount/supplierCount", async () => {
      const admin = await registerOrg(app, "List Org");
      const pr = await createApprovedPR(app, admin, [freeTextItem]);
      const supplier = await createSupplierActive(app, admin.accessToken);
      const rfq = await createRfqOk(app, admin.accessToken, {
        purchaseRequestId: pr.id,
        purchaseRequestItemIds: [pr.items[0]!.id],
        supplierIds: [supplier.id],
      });

      const byStatus = await authed(app, admin.accessToken).get("/api/v1/rfqs?status=DRAFT");
      expect((byStatus.body.items as Array<{ id: string }>).some((r) => r.id === rfq.id)).toBe(true);

      const byPr = await authed(app, admin.accessToken).get(`/api/v1/rfqs?purchaseRequestId=${pr.id}`);
      const row = (byPr.body.items as Array<{ id: string; itemCount: number; supplierCount: number }>).find((r) => r.id === rfq.id);
      expect(row?.itemCount).toBe(1);
      expect(row?.supplierCount).toBe(1);
    });

    it("search matches rfqNumber and the source PurchaseRequest's requestNumber", async () => {
      const admin = await registerOrg(app, "List Search Org");
      const pr = await createApprovedPR(app, admin);
      const rfq = await createRfqOk(app, admin.accessToken, { purchaseRequestId: pr.id });

      const byRfqNumber = await authed(app, admin.accessToken).get(`/api/v1/rfqs?search=${rfq.rfqNumber}`);
      expect((byRfqNumber.body.items as Array<{ id: string }>).some((r) => r.id === rfq.id)).toBe(true);

      const byPrNumber = await authed(app, admin.accessToken).get(`/api/v1/rfqs?search=${pr.requestNumber}`);
      expect((byPrNumber.body.items as Array<{ id: string }>).some((r) => r.id === rfq.id)).toBe(true);
    });

    it("never leaks another organization's RFQs", async () => {
      const orgA = await registerOrg(app, "List Isolation A");
      const orgB = await registerOrg(app, "List Isolation B");
      const pr = await createApprovedPR(app, orgA);
      await createRfqOk(app, orgA.accessToken, { purchaseRequestId: pr.id });
      const res = await authed(app, orgB.accessToken).get("/api/v1/rfqs");
      expect(res.body.items).toHaveLength(0);
    });

    it("respects page/pageSize and rejects pageSize above 100", async () => {
      const admin = await registerOrg(app, "List Pagination Org");
      const res = await authed(app, admin.accessToken).get("/api/v1/rfqs?page=1&pageSize=5");
      expect(res.status).toBe(200);
      expect(res.body.pageSize).toBe(5);
      const tooLarge = await authed(app, admin.accessToken).get("/api/v1/rfqs?pageSize=101");
      expect(tooLarge.status).toBe(400);
    });

    it("orders deterministically (createdAt desc, rfqNumber desc as tiebreaker) even when several RFQs share the same createdAt millisecond", async () => {
      const admin = await registerOrg(app, "List Stable Order Org");
      const pr = await createApprovedPR(app, admin);
      // Fired back-to-back — on a fast CI host these frequently land in the same createdAt millisecond,
      // which is exactly the tie the rfqNumber-desc secondary sort key exists to break deterministically.
      const rfqs = await Promise.all([1, 2, 3, 4, 5].map(() => createRfqOk(app, admin.accessToken, { purchaseRequestId: pr.id })));
      const expectedOrder = [...rfqs].sort((a, b) => (a.rfqNumber < b.rfqNumber ? 1 : -1)).map((r) => r.id);

      const first = await authed(app, admin.accessToken).get(`/api/v1/rfqs?purchaseRequestId=${pr.id}&pageSize=10`);
      const second = await authed(app, admin.accessToken).get(`/api/v1/rfqs?purchaseRequestId=${pr.id}&pageSize=10`);
      const firstIds = (first.body.items as Array<{ id: string }>).map((r) => r.id);
      const secondIds = (second.body.items as Array<{ id: string }>).map((r) => r.id);

      expect(firstIds).toEqual(secondIds); // stable across repeated calls
      expect(firstIds).toEqual(expectedOrder); // and matches the deterministic rfqNumber-desc tiebreak
    });
  });

  // ────────────────────────────────────────────────────────────
  // DETAIL / SERIALIZATION
  // ────────────────────────────────────────────────────────────

  describe("detail / serialization", () => {
    it("returns bounded RfqDetail — header, PR summary, items[], suppliers[] — never Quote/token/idempotency fields", async () => {
      const admin = await registerOrg(app, "Detail Bounded Org");
      const pr = await createApprovedPR(app, admin, [freeTextItem]);
      const supplier = await createSupplierActive(app, admin.accessToken);
      const rfq = await createRfqOk(app, admin.accessToken, {
        purchaseRequestId: pr.id,
        purchaseRequestItemIds: [pr.items[0]!.id],
        supplierIds: [supplier.id],
        internalNotes: "Internal only",
      });

      const detail = await authed(app, admin.accessToken).get(`/api/v1/rfqs/${rfq.id}`);
      expect(detail.status).toBe(200);
      expect(detail.body.purchaseRequest).toEqual({ id: pr.id, requestNumber: pr.requestNumber, status: "APPROVED" });
      expect(detail.body.internalNotes).toBe("Internal only");
      expect(detail.body).not.toHaveProperty("idempotencyKey");
      expect(detail.body).not.toHaveProperty("payloadHash");
      expect(detail.body).not.toHaveProperty("quote");
      expect(detail.body).not.toHaveProperty("recommendations");
      expect(detail.body.suppliers[0]).not.toHaveProperty("portalTokenHash");
      expect(detail.body.suppliers[0]).not.toHaveProperty("tokenExpiresAt");
      expect(detail.body.suppliers[0].currentSupplierStatus).toBe("ACTIVE");
      expect(typeof detail.body.items[0].quantity).toBe("string");
    });

    it("cross-org GET /rfqs/:id is 404, not 403", async () => {
      const orgA = await registerOrg(app, "Detail Cross A");
      const orgB = await registerOrg(app, "Detail Cross B");
      const pr = await createApprovedPR(app, orgA);
      const rfq = await createRfqOk(app, orgA.accessToken, { purchaseRequestId: pr.id });
      const res = await authed(app, orgB.accessToken).get(`/api/v1/rfqs/${rfq.id}`);
      expect(res.status).toBe(404);
    });

    it("a nonexistent RFQ id is 404", async () => {
      const admin = await registerOrg(app, "Detail Missing Org");
      const res = await authed(app, admin.accessToken).get("/api/v1/rfqs/00000000-0000-0000-0000-000000000000");
      expect(res.status).toBe(404);
    });
  });

  // ────────────────────────────────────────────────────────────
  // MASS ASSIGNMENT PROTECTION
  // ────────────────────────────────────────────────────────────

  describe("mass assignment protection", () => {
    it("rejects server-managed fields on create (400)", async () => {
      const admin = await registerOrg(app, "Mass Assignment Org");
      const pr = await createApprovedPR(app, admin);
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/rfqs")
        .send({ purchaseRequestId: pr.id, status: "SENT", rfqNumber: "RFQ-2020-000001", createdById: "hacked" });
      expect(res.status).toBe(400);
    });

    it("rejects server-managed fields on PATCH (400)", async () => {
      const admin = await registerOrg(app, "Mass Assignment Patch Org");
      const pr = await createApprovedPR(app, admin);
      const rfq = await createRfqOk(app, admin.accessToken, { purchaseRequestId: pr.id });
      const res = await authed(app, admin.accessToken).patch(`/api/v1/rfqs/${rfq.id}`).send({ status: "SENT" });
      expect(res.status).toBe(400);
    });
  });

  // ────────────────────────────────────────────────────────────
  // RBAC MATRIX
  // ────────────────────────────────────────────────────────────

  describe("RBAC", () => {
    it("EMPLOYEE/APPROVER/SUPPLIER cannot read or write RFQs (403)", async () => {
      const admin = await registerOrg(app, "RBAC Org");
      const pr = await createApprovedPR(app, admin);
      const rfq = await createRfqOk(app, admin.accessToken, { purchaseRequestId: pr.id });
      for (const role of ["EMPLOYEE", "APPROVER", "SUPPLIER"]) {
        const user = await inviteAndLogin(app, admin, role);
        expect((await authed(app, user.accessToken).get("/api/v1/rfqs")).status).toBe(403);
        expect((await authed(app, user.accessToken).get(`/api/v1/rfqs/${rfq.id}`)).status).toBe(403);
        expect((await authed(app, user.accessToken).post("/api/v1/rfqs").send({ purchaseRequestId: pr.id })).status).toBe(403);
        expect((await authed(app, user.accessToken).patch(`/api/v1/rfqs/${rfq.id}`).send({ internalNotes: "x" })).status).toBe(403);
        expect((await authed(app, user.accessToken).post(`/api/v1/rfqs/${rfq.id}/items`).send({ purchaseRequestItemId: pr.items[0]!.id })).status).toBe(403);
        expect((await authed(app, user.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers`).send({ supplierId: "x" })).status).toBe(403);
        expect((await authed(app, user.accessToken).post(`/api/v1/rfqs/${rfq.id}/send`)).status).toBe(403);
        expect((await authed(app, user.accessToken).post(`/api/v1/rfqs/${rfq.id}/close`)).status).toBe(403);
        expect((await authed(app, user.accessToken).post(`/api/v1/rfqs/${rfq.id}/cancel`)).status).toBe(403);
      }
    });

    it("ADMIN, PROCUREMENT_MANAGER, PROCUREMENT_SPECIALIST all have full access", async () => {
      const admin = await registerOrg(app, "RBAC Full Org");
      const manager = await inviteAndLogin(app, admin, "PROCUREMENT_MANAGER");
      const specialist = await inviteAndLogin(app, admin, "PROCUREMENT_SPECIALIST");

      for (const actor of [admin, manager, specialist]) {
        const pr = await createApprovedPR(app, admin);
        const created = await authed(app, actor.accessToken).post("/api/v1/rfqs").send({ purchaseRequestId: pr.id });
        expect(created.status).toBe(201);
        expect((await authed(app, actor.accessToken).get("/api/v1/rfqs")).status).toBe(200);
        expect((await authed(app, actor.accessToken).get(`/api/v1/rfqs/${created.body.id}`)).status).toBe(200);
        expect((await authed(app, actor.accessToken).patch(`/api/v1/rfqs/${created.body.id}`).send({ internalNotes: "ok" })).status).toBe(200);
      }
    });
  });

  // ────────────────────────────────────────────────────────────
  // TENANT / IDOR MATRIX
  // ────────────────────────────────────────────────────────────

  describe("tenant / IDOR", () => {
    it("foreign RFQ item id / supplier id / RFQ PATCH are all 404 for a cross-org caller", async () => {
      const orgA = await registerOrg(app, "IDOR A");
      const orgB = await registerOrg(app, "IDOR B");
      const pr = await createApprovedPR(app, orgA, [freeTextItem]);
      const supplier = await createSupplierActive(app, orgA.accessToken);
      const rfq = await createRfqOk(app, orgA.accessToken, {
        purchaseRequestId: pr.id,
        purchaseRequestItemIds: [pr.items[0]!.id],
        supplierIds: [supplier.id],
      });
      const detail = await authed(app, orgA.accessToken).get(`/api/v1/rfqs/${rfq.id}`);
      const rfqItemId = detail.body.items[0].id as string;
      const rfqSupplierId = detail.body.suppliers[0].id as string;

      expect((await authed(app, orgB.accessToken).patch(`/api/v1/rfqs/${rfq.id}`).send({ internalNotes: "x" })).status).toBe(404);
      expect((await authed(app, orgB.accessToken).delete(`/api/v1/rfqs/${rfq.id}/items/${rfqItemId}`)).status).toBe(404);
      expect((await authed(app, orgB.accessToken).delete(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}`)).status).toBe(404);
      expect((await authed(app, orgB.accessToken).post(`/api/v1/rfqs/${rfq.id}/send`)).status).toBe(404);
      expect((await authed(app, orgB.accessToken).post(`/api/v1/rfqs/${rfq.id}/close`)).status).toBe(404);
      expect((await authed(app, orgB.accessToken).post(`/api/v1/rfqs/${rfq.id}/cancel`)).status).toBe(404);
    });

    it("a same-org RFQ cannot add a cross-org supplier via POST /suppliers", async () => {
      const orgA = await registerOrg(app, "IDOR Supplier Add A");
      const orgB = await registerOrg(app, "IDOR Supplier Add B");
      const pr = await createApprovedPR(app, orgA);
      const rfq = await createRfqOk(app, orgA.accessToken, { purchaseRequestId: pr.id });
      const foreignSupplier = await createSupplierActive(app, orgB.accessToken);
      const res = await authed(app, orgA.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers`).send({ supplierId: foreignSupplier.id });
      expect(res.status).toBe(404);
    });

    it("a same-org RFQ cannot add an item from a foreign PurchaseRequest", async () => {
      const orgA = await registerOrg(app, "IDOR Item Add A");
      const orgB = await registerOrg(app, "IDOR Item Add B");
      const pr = await createApprovedPR(app, orgA);
      const rfq = await createRfqOk(app, orgA.accessToken, { purchaseRequestId: pr.id });
      const foreignPr = await createApprovedPR(app, orgB);
      const res = await authed(app, orgA.accessToken).post(`/api/v1/rfqs/${rfq.id}/items`).send({ purchaseRequestItemId: foreignPr.items[0]!.id });
      expect(res.status).toBe(404);
    });
  });
});
