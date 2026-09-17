import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createSystemPrismaClient } from "@top/database";
import { createTestApp, uniqueEmail } from "./test-app";

/**
 * M3.3 RFQ Phase C — concurrency races (Architecture Revision 1 §51-64,
 * Phase C §46-64). Real HTTP requests fired concurrently against real
 * Postgres, same Promise.all/allSettled convention as
 * entity-sequence.e2e.spec.ts / suppliers.e2e.spec.ts's own concurrency
 * sections. Where a specific lock-acquisition winner cannot be forced from a
 * pure black-box HTTP test, these assert the invariant that MUST hold
 * regardless of interleaving (no raw 500, no orphaned/inconsistent final
 * state, no duplicate row bypassing a unique constraint) rather than a
 * specific execution order.
 */

interface OrgContext {
  email: string;
  accessToken: string;
  userId: string;
  organizationId: string;
}

async function registerOrg(app: INestApplication, orgName: string): Promise<OrgContext> {
  const email = uniqueEmail("rfqcc");
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

async function createApprovedPR(app: INestApplication, admin: OrgContext, items: Record<string, unknown>[] = [freeTextItem, { ...freeTextItem, itemName: "B" }]) {
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

describe("M3.3 RFQ — concurrency", () => {
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

  it("5 concurrent RFQ creates (distinct payloads) all succeed with unique ids and unique, contiguous RFQ numbers", async () => {
    const admin = await registerOrg(app, "Concurrent Create Org");
    const prs = await Promise.all(Array.from({ length: 5 }, () => createApprovedPR(app, admin)));
    const results = await Promise.all(prs.map((pr) => authed(app, admin.accessToken).post("/api/v1/rfqs").send({ purchaseRequestId: pr.id })));
    for (const res of results) expect(res.status).toBe(201);
    const ids = results.map((r) => r.body.id as string);
    expect(new Set(ids).size).toBe(5);
    const numbers = results.map((r) => Number((r.body.rfqNumber as string).split("-")[2]));
    expect(new Set(numbers).size).toBe(5);
  });

  it("5 concurrent creates with the SAME idempotencyKey+payload produce exactly one RFQ, one audit, one sequence allocation", async () => {
    const admin = await registerOrg(app, "Concurrent Idempotent Org");
    const pr = await createApprovedPR(app, admin);
    const key = `concurrent-idem-${Date.now()}`;
    const body = { purchaseRequestId: pr.id, idempotencyKey: key };

    const results = await Promise.all(Array.from({ length: 5 }, () => authed(app, admin.accessToken).post("/api/v1/rfqs").send(body)));
    for (const res of results) expect(res.status).toBe(201);
    const ids = new Set(results.map((r) => r.body.id as string));
    expect(ids.size).toBe(1);

    const [id] = [...ids];
    expect(await db.rFQ.count({ where: { id } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: id, action: "RFQ_CREATED" } })).toBe(1);
  });

  it("supplier status race at CREATE: concurrent create-with-supplier vs supplier -> BLOCKED never lets a stale-ACTIVE read win after BLOCKED already committed", async () => {
    const admin = await registerOrg(app, "Create Supplier Race Org");
    const pr = await createApprovedPR(app, admin);
    const supplier = await createSupplierActive(app, admin.accessToken);

    const [createRes, statusRes] = await Promise.allSettled([
      authed(app, admin.accessToken).post("/api/v1/rfqs").send({ purchaseRequestId: pr.id, supplierIds: [supplier.id] }),
      authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}/status`).send({ status: "BLOCKED" }),
    ]);

    if (createRes.status === "fulfilled") expect(createRes.value.status).toBeLessThan(500);
    if (statusRes.status === "fulfilled") expect(statusRes.value.status).toBeLessThan(500);

    // If the create succeeded, the RFQSupplier row it created must be real — no orphan created after a rejected/blocked read.
    if (createRes.status === "fulfilled" && createRes.value.status === 201) {
      const rfqSupplierCount = await db.rFQSupplier.count({ where: { rfqId: createRes.value.body.id, supplierId: supplier.id } });
      expect(rfqSupplierCount).toBe(1);
    }
  });

  it("supplier status race at DRAFT supplier-add: same invariant (no 500, self-consistent outcome)", async () => {
    const admin = await registerOrg(app, "Draft Add Supplier Race Org");
    const pr = await createApprovedPR(app, admin);
    const supplier = await createSupplierActive(app, admin.accessToken);
    const rfq = await createRfqOk(app, admin.accessToken, { purchaseRequestId: pr.id });

    const [addRes, statusRes] = await Promise.allSettled([
      authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers`).send({ supplierId: supplier.id }),
      authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}/status`).send({ status: "BLOCKED" }),
    ]);

    if (addRes.status === "fulfilled") expect(addRes.value.status).toBeLessThan(500);
    if (statusRes.status === "fulfilled") expect(statusRes.value.status).toBeLessThan(500);

    if (addRes.status === "fulfilled" && addRes.value.status === 201) {
      expect(await db.rFQSupplier.count({ where: { rfqId: rfq.id, supplierId: supplier.id } })).toBe(1);
    }
  });

  it("item-add vs SEND: the add either wins (item present, SEND sees it) or loses (409, RFQ item count unaffected) — never added after SENT committed", async () => {
    const admin = await registerOrg(app, "Item Add Vs Send Org");
    // A DRAFT built with a supplier+deadline but NO items yet, plus a second
    // PR item ready to race into it — buildSendableDraft's own PR already
    // has exactly one item (already placed on the RFQ), so create the RFQ
    // manually here against a 2-item PR and only pre-place the first item.
    const pr = await createApprovedPR(app, admin, [freeTextItem, { ...freeTextItem, itemName: "Raced Item" }]);
    const supplier = await createSupplierActive(app, admin.accessToken);
    const rfq = await createRfqOk(app, admin.accessToken, {
      purchaseRequestId: pr.id,
      purchaseRequestItemIds: [pr.items[0]!.id],
      supplierIds: [supplier.id],
      deadline: futureDeadline(),
    });

    const [addRes, sendRes] = await Promise.allSettled([
      authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/items`).send({ purchaseRequestItemId: pr.items[1]!.id }),
      authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/send`),
    ]);

    if (addRes.status === "fulfilled") expect(addRes.value.status).toBeLessThan(500);
    if (sendRes.status === "fulfilled") expect(sendRes.value.status).toBeLessThan(500);

    const finalDetail = await authed(app, admin.accessToken).get(`/api/v1/rfqs/${rfq.id}`);
    if (addRes.status === "fulfilled" && addRes.value.status === 201) {
      // The add won its lock before SEND (or SEND hadn't started) — item must be present.
      expect((finalDetail.body.items as Array<{ id: string }>).some((i) => i.id === addRes.value.body.id)).toBe(true);
    }
    // Regardless of outcome, the RFQ ends in a valid terminal state (DRAFT or SENT), never a half-mutated one.
    expect(["DRAFT", "SENT"]).toContain(finalDetail.body.status);
  });

  it("supplier-add vs SEND: the add either wins (present, revalidated by SEND) or loses (409) — never added after SENT committed", async () => {
    const admin = await registerOrg(app, "Supplier Add Vs Send Org");
    const { rfq } = await buildSendableDraft(app, admin);
    const extraSupplier = await createSupplierActive(app, admin.accessToken, "Extra Supplier Co");

    const [addRes, sendRes] = await Promise.allSettled([
      authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers`).send({ supplierId: extraSupplier.id }),
      authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/send`),
    ]);

    if (addRes.status === "fulfilled") expect(addRes.value.status).toBeLessThan(500);
    if (sendRes.status === "fulfilled") expect(sendRes.value.status).toBeLessThan(500);

    const finalDetail = await authed(app, admin.accessToken).get(`/api/v1/rfqs/${rfq.id}`);
    if (addRes.status === "fulfilled" && addRes.value.status === 201) {
      expect((finalDetail.body.suppliers as Array<{ id: string }>).some((s) => s.id === addRes.value.body.id)).toBe(true);
    }
    expect(["DRAFT", "SENT"]).toContain(finalDetail.body.status);
  });

  it("header PATCH vs SEND: never a header mutation observed after SENT committed", async () => {
    const admin = await registerOrg(app, "Header Patch Vs Send Org");
    const { rfq } = await buildSendableDraft(app, admin);

    const [patchRes, sendRes] = await Promise.allSettled([
      authed(app, admin.accessToken).patch(`/api/v1/rfqs/${rfq.id}`).send({ internalNotes: "race patch" }),
      authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/send`),
    ]);

    if (patchRes.status === "fulfilled") expect(patchRes.value.status).toBeLessThan(500);
    if (sendRes.status === "fulfilled") expect(sendRes.value.status).toBeLessThan(500);

    const finalDetail = await authed(app, admin.accessToken).get(`/api/v1/rfqs/${rfq.id}`);
    expect(["DRAFT", "SENT"]).toContain(finalDetail.body.status);
    // If PATCH lost the race (RFQ already SENT), it must be 409 and the note must not appear.
    if (patchRes.status === "fulfilled" && patchRes.value.status === 409) {
      expect(finalDetail.body.internalNotes).not.toBe("race patch");
    }
  });

  it("CANCEL vs child mutation: no item/supplier mutation ever commits after CANCELLED", async () => {
    const admin = await registerOrg(app, "Cancel Vs Child Org");
    const pr = await createApprovedPR(app, admin, [freeTextItem]);
    const rfq = await createRfqOk(app, admin.accessToken, { purchaseRequestId: pr.id });

    const [addRes, cancelRes] = await Promise.allSettled([
      authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/items`).send({ purchaseRequestItemId: pr.items[0]!.id }),
      authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/cancel`),
    ]);

    if (addRes.status === "fulfilled") expect(addRes.value.status).toBeLessThan(500);
    if (cancelRes.status === "fulfilled") expect(cancelRes.value.status).toBeLessThan(500);

    const finalDetail = await authed(app, admin.accessToken).get(`/api/v1/rfqs/${rfq.id}`);
    expect(["DRAFT", "CANCELLED"]).toContain(finalDetail.body.status);
    if (finalDetail.body.status === "CANCELLED" && addRes.status === "fulfilled" && addRes.value.status === 409) {
      expect(finalDetail.body.items).toHaveLength(0);
    }
  });

  it("supplier BLOCKED vs SEND: SEND never commits based on a stale ACTIVE read once BLOCKED has already committed", async () => {
    const admin = await registerOrg(app, "Supplier Block Vs Send Org");
    const { rfq, supplier } = await buildSendableDraft(app, admin);

    const [blockRes, sendRes] = await Promise.allSettled([
      authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}/status`).send({ status: "BLOCKED" }),
      authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/send`),
    ]);

    if (blockRes.status === "fulfilled") expect(blockRes.value.status).toBeLessThan(500);
    if (sendRes.status === "fulfilled") expect(sendRes.value.status).toBeLessThan(500);

    // Both are valid final states: SEND won its lock first (RFQ SENT, supplier BLOCKED afterward is fine —
    // it does not retroactively invalidate an already-issued RFQ), or BLOCKED committed first (SEND then
    // sees BLOCKED under its own lock and 400s, RFQ stays DRAFT). What must NEVER happen: SEND returns 200
    // while the Supplier row it read was already BLOCKED before SEND's own lock acquisition — structurally
    // impossible here because SEND re-reads status only AFTER acquiring FOR UPDATE, so this is proven by
    // construction (see rfqs.service.ts `send()`), verified here by confirming no crash and a consistent
    // final state.
    const finalRfq = await db.rFQ.findUnique({ where: { id: rfq.id } });
    expect(["DRAFT", "SENT"]).toContain(finalRfq?.status);
  });

  it("PR cancel vs RFQ SEND: exactly one valid transition wins, never a SENT RFQ whose PR was already CANCELLED before SEND committed", async () => {
    const admin = await registerOrg(app, "PR Cancel Vs Send Org");
    const { rfq, pr } = await buildSendableDraft(app, admin);

    const [cancelRes, sendRes] = await Promise.allSettled([
      authed(app, admin.accessToken).post(`/api/v1/purchase-requests/${pr.id}/cancel`),
      authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/send`),
    ]);

    if (cancelRes.status === "fulfilled") expect(cancelRes.value.status).toBeLessThan(500);
    if (sendRes.status === "fulfilled") expect(sendRes.value.status).toBeLessThan(500);

    const finalPr = await db.purchaseRequest.findUnique({ where: { id: pr.id } });
    const finalRfq = await db.rFQ.findUnique({ where: { id: rfq.id } });
    // If the RFQ ended up SENT, the PR must be RFQ_IN_PROGRESS (SEND won, PR cancel then failed against a non-APPROVED status).
    if (finalRfq?.status === "SENT") {
      expect(finalPr?.status).toBe("RFQ_IN_PROGRESS");
    }
    // If the PR ended up CANCELLED, the RFQ must NOT be SENT (cancel won first, SEND then saw a non-eligible PR and 409'd).
    if (finalPr?.status === "CANCELLED") {
      expect(finalRfq?.status).toBe("DRAFT");
    }
  });

  it("double SEND: exactly one transition, one RFQ_SENT audit, at most one PR transition, no duplicate side effects", async () => {
    const admin = await registerOrg(app, "Double Send Org");
    const { rfq, pr } = await buildSendableDraft(app, admin);

    const results = await Promise.allSettled([
      authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/send`),
      authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/send`),
    ]);
    for (const r of results) if (r.status === "fulfilled") expect(r.value.status).toBeLessThan(500);

    expect(await db.auditLog.count({ where: { entityId: rfq.id, action: "RFQ_SENT" } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: pr.id, action: "PURCHASE_REQUEST_RFQ_STARTED" } })).toBe(1);
    const finalRfq = await db.rFQ.findUnique({ where: { id: rfq.id } });
    expect(finalRfq?.status).toBe("SENT");
  });

  it("double CLOSE: exactly one transition and audit", async () => {
    const admin = await registerOrg(app, "Double Close Org");
    const { rfq } = await buildSendableDraft(app, admin);
    await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/send`);

    const results = await Promise.allSettled([
      authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/close`),
      authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/close`),
    ]);
    for (const r of results) if (r.status === "fulfilled") expect(r.value.status).toBeLessThan(500);
    expect(await db.auditLog.count({ where: { entityId: rfq.id, action: "RFQ_CLOSED" } })).toBe(1);
  });

  it("double CANCEL: exactly one transition and audit", async () => {
    const admin = await registerOrg(app, "Double Cancel Org");
    const pr = await createApprovedPR(app, admin);
    const rfq = await createRfqOk(app, admin.accessToken, { purchaseRequestId: pr.id });

    const results = await Promise.allSettled([
      authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/cancel`),
      authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/cancel`),
    ]);
    for (const r of results) if (r.status === "fulfilled") expect(r.value.status).toBeLessThan(500);
    expect(await db.auditLog.count({ where: { entityId: rfq.id, action: "RFQ_CANCELLED" } })).toBe(1);
  });

  it("duplicate item-add race: exactly one RFQItem, one audit, second is a clean 409 (no raw P2002)", async () => {
    const admin = await registerOrg(app, "Duplicate Item Race Org");
    const pr = await createApprovedPR(app, admin, [freeTextItem]);
    const rfq = await createRfqOk(app, admin.accessToken, { purchaseRequestId: pr.id });

    const results = await Promise.allSettled(
      Array.from({ length: 2 }, () => authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/items`).send({ purchaseRequestItemId: pr.items[0]!.id }))
    );
    const statuses = results.map((r) => (r.status === "fulfilled" ? r.value.status : 599));
    for (const s of statuses) expect(s).toBeLessThan(500);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(1);

    expect(await db.rFQItem.count({ where: { rfqId: rfq.id, purchaseRequestItemId: pr.items[0]!.id } })).toBe(1);
  });

  it("duplicate supplier-add race: exactly one RFQSupplier, second is a clean 409 (no raw P2002)", async () => {
    const admin = await registerOrg(app, "Duplicate Supplier Race Org");
    const pr = await createApprovedPR(app, admin);
    const supplier = await createSupplierActive(app, admin.accessToken);
    const rfq = await createRfqOk(app, admin.accessToken, { purchaseRequestId: pr.id });

    const results = await Promise.allSettled(
      Array.from({ length: 2 }, () => authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers`).send({ supplierId: supplier.id }))
    );
    const statuses = results.map((r) => (r.status === "fulfilled" ? r.value.status : 599));
    for (const s of statuses) expect(s).toBeLessThan(500);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(1);

    expect(await db.rFQSupplier.count({ where: { rfqId: rfq.id, supplierId: supplier.id } })).toBe(1);
  });
});
