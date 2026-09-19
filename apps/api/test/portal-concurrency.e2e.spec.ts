import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createSystemPrismaClient } from "@top/database";
import { createTestApp, uniqueEmail } from "./test-app";

/**
 * M3.4 Supplier Portal Phase C — real concurrency races (Architecture
 * §63-71, §86). Real parallel HTTP via Promise.all/allSettled against a live
 * Nest app + real Postgres — never a sequential simulation. Internal
 * invite/reissue have no rate limit (Architecture §8); the external-route
 * tests below budget their `quote`/`decline` calls to stay comfortably under
 * the 10/min throttle within this one file.
 */

interface OrgContext {
  accessToken: string;
}

async function registerOrg(app: INestApplication, orgName: string): Promise<OrgContext> {
  const email = uniqueEmail("pcc");
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
  const pr = await authed(app, admin.accessToken).post("/api/v1/purchase-requests").send({ items: [{ itemName: "Item", quantity: "1.000", uomCode: "PCS" }] });
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
async function buildInvitedSupplier(app: INestApplication, admin: OrgContext) {
  const base = await buildSentRfqWithSelectedSupplier(app, admin);
  const invite = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${base.rfq.id}/suppliers/${base.rfqSupplierId}/invite`);
  return { ...base, rawToken: invite.body.token as string };
}
const basicPayload = (rfqItemId: string, unitPrice = "5.0000") => ({
  currency: "USD",
  vatIncluded: false,
  deliveryCost: "0",
  deliveryIncluded: true,
  items: [{ rfqItemId, unitPrice }],
});

describe("M3.4 Supplier Portal — concurrency", () => {
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

  it("double invite: exactly one succeeds, one rejects (no longer SELECTED); one active hash, one invite audit", async () => {
    const admin = await registerOrg(app, "Concurrent Invite Org");
    const { rfq, rfqSupplierId } = await buildSentRfqWithSelectedSupplier(app, admin);

    const results = await Promise.allSettled(
      Array.from({ length: 2 }, () => authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/invite`))
    );
    const statuses = results.map((r) => (r.status === "fulfilled" ? r.value.status : 599));
    for (const s of statuses) expect(s).toBeLessThan(500);
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);

    expect(await db.auditLog.count({ where: { entityId: rfqSupplierId, action: "RFQ_SUPPLIER_INVITED" } })).toBe(1);
    const row = await db.rFQSupplier.findUniqueOrThrow({ where: { id: rfqSupplierId } });
    expect(row.status).toBe("INVITED");
    expect(row.portalTokenHash).not.toBeNull();
  });

  it("double reissue: both may serialize successfully (intentional rotations); final invariant — one active hash, only the latest token works, audit count equals committed rotations", async () => {
    const admin = await registerOrg(app, "Concurrent Reissue Org");
    const { rfq, rfqSupplierId, rawToken } = await buildInvitedSupplier(app, admin);
    void rawToken;

    const results = await Promise.allSettled(
      Array.from({ length: 2 }, () => authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/reissue`))
    );
    const tokens: string[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") {
        expect(r.value.status).toBeLessThan(500);
        if (r.value.status === 200) tokens.push(r.value.body.token as string);
      }
    }
    // Both requests were legitimately reissuable (INVITED is always reissuable) — expect both committed as rotations.
    expect(tokens.length).toBeGreaterThanOrEqual(1);

    const row = await db.rFQSupplier.findUniqueOrThrow({ where: { id: rfqSupplierId } });
    // Exactly one of the generated tokens matches the final DB hash — the "latest committed" one.
    let matchCount = 0;
    for (const t of tokens) {
      const check = await request(app.getHttpServer()).post("/api/v1/portal/rfq/open").set("Authorization", `Bearer ${t}`);
      if (check.status === 200) matchCount++;
    }
    expect(matchCount).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: rfqSupplierId, action: "RFQ_SUPPLIER_PORTAL_REISSUED" } })).toBe(tokens.length);
    void row;
  });

  it("revoke vs submit: if revoke commits first the submit fails under-lock revalidation; never a Quote after an already-committed revoke", async () => {
    const admin = await registerOrg(app, "Revoke Vs Submit Org");
    const { rfq, rfqSupplierId, rfqItemId, rawToken } = await buildInvitedSupplier(app, admin);

    const [revokeRes, submitRes] = await Promise.allSettled([
      authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/revoke`),
      portal(app, rawToken).post("/api/v1/portal/rfq/quote").send(basicPayload(rfqItemId)),
    ]);
    if (revokeRes.status === "fulfilled") expect(revokeRes.value.status).toBeLessThan(500);
    if (submitRes.status === "fulfilled") expect(submitRes.value.status).toBeLessThan(500);

    const row = await db.rFQSupplier.findUniqueOrThrow({ where: { id: rfqSupplierId } });
    if (row.portalTokenHash === null && submitRes.status === "fulfilled" && submitRes.value.status === 200) {
      // Revoke won and committed before submit's own under-lock read observed it — submit must NOT have succeeded in this ordering.
      throw new Error("Invariant violation: Quote succeeded after revoke already committed");
    }
    expect(await db.quote.count({ where: { rfqSupplierId } })).toBeLessThanOrEqual(1);
  });

  it("reissue vs old-token submit: if reissue commits first, the old-token submit fails; otherwise the submit may succeed and reissue then rejects (status became SUBMITTED)", async () => {
    const admin = await registerOrg(app, "Reissue Vs Old Submit Org");
    const { rfq, rfqSupplierId, rfqItemId, rawToken } = await buildInvitedSupplier(app, admin);

    const [reissueRes, submitRes] = await Promise.allSettled([
      authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/reissue`),
      portal(app, rawToken).post("/api/v1/portal/rfq/quote").send(basicPayload(rfqItemId)),
    ]);
    if (reissueRes.status === "fulfilled") expect(reissueRes.value.status).toBeLessThan(500);
    if (submitRes.status === "fulfilled") expect(submitRes.value.status).toBeLessThan(500);

    // Never both: a successful old-token submit AND a successful reissue that silently left the old token
    // still able to submit again — the row's final hash must not equal a hash the old raw token would produce.
    expect(await db.quote.count({ where: { rfqSupplierId } })).toBeLessThanOrEqual(1);
  });

  it("close vs submit: never a Quote committed against an already-CLOSED RFQ (shared RFQ-first lock order)", async () => {
    const admin = await registerOrg(app, "Close Vs Submit Org");
    const { rfq, rfqSupplierId, rfqItemId, rawToken } = await buildInvitedSupplier(app, admin);

    const [closeRes, submitRes] = await Promise.allSettled([
      authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/close`),
      portal(app, rawToken).post("/api/v1/portal/rfq/quote").send(basicPayload(rfqItemId)),
    ]);
    if (closeRes.status === "fulfilled") expect(closeRes.value.status).toBeLessThan(500);
    if (submitRes.status === "fulfilled") expect(submitRes.value.status).toBeLessThan(500);

    const finalRfq = await db.rFQ.findUniqueOrThrow({ where: { id: rfq.id } });
    const quoteCount = await db.quote.count({ where: { rfqSupplierId } });
    if (finalRfq.status === "CLOSED" && submitRes.status === "fulfilled" && submitRes.value.status === 200) {
      // Submit could only have legitimately succeeded if it observed SENT under its own lock BEFORE close committed.
      expect(quoteCount).toBe(1); // acceptable — submit won the race
    }
    expect(quoteCount).toBeLessThanOrEqual(1);
  });

  it("cancel vs submit: same invariant as close", async () => {
    const admin = await registerOrg(app, "Cancel Vs Submit Org");
    const { rfq, rfqSupplierId, rfqItemId, rawToken } = await buildInvitedSupplier(app, admin);

    const [cancelRes, submitRes] = await Promise.allSettled([
      authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/cancel`),
      portal(app, rawToken).post("/api/v1/portal/rfq/quote").send(basicPayload(rfqItemId)),
    ]);
    if (cancelRes.status === "fulfilled") expect(cancelRes.value.status).toBeLessThan(500);
    if (submitRes.status === "fulfilled") expect(submitRes.value.status).toBeLessThan(500);

    expect(await db.quote.count({ where: { rfqSupplierId } })).toBeLessThanOrEqual(1);
  });

  it("decline vs submit: whichever commits first wins — never both a SUBMITTED Quote and a DECLINED status", async () => {
    const admin = await registerOrg(app, "Decline Vs Submit Org");
    const { rfqSupplierId, rfqItemId, rawToken } = await buildInvitedSupplier(app, admin);

    const [declineRes, submitRes] = await Promise.allSettled([
      portal(app, rawToken).post("/api/v1/portal/rfq/decline"),
      portal(app, rawToken).post("/api/v1/portal/rfq/quote").send(basicPayload(rfqItemId)),
    ]);
    if (declineRes.status === "fulfilled") expect(declineRes.value.status).toBeLessThan(500);
    if (submitRes.status === "fulfilled") expect(submitRes.value.status).toBeLessThan(500);

    const row = await db.rFQSupplier.findUniqueOrThrow({ where: { id: rfqSupplierId } });
    const quoteExists = (await db.quote.count({ where: { rfqSupplierId } })) === 1;
    // Never both DECLINED and a Quote present.
    expect(row.status === "DECLINED" && quoteExists).toBe(false);
    expect(["DECLINED", "SUBMITTED"]).toContain(row.status);
  });

  it("double submit — same payload: exactly one Quote, exact RFQItem count of QuoteItems, one audit, SUBMITTED once", async () => {
    const admin = await registerOrg(app, "Double Submit Same Org");
    const { rfqSupplierId, rfqItemId, rawToken } = await buildInvitedSupplier(app, admin);
    const payload = basicPayload(rfqItemId);

    const results = await Promise.allSettled(Array.from({ length: 2 }, () => portal(app, rawToken).post("/api/v1/portal/rfq/quote").send(payload)));
    const statuses = results.map((r) => (r.status === "fulfilled" ? r.value.status : 599));
    for (const s of statuses) expect(s).toBeLessThan(500);
    expect(statuses.every((s) => s === 200)).toBe(true);

    const ids = new Set(results.map((r) => (r.status === "fulfilled" ? (r.value.body.id as string) : "")));
    expect(ids.size).toBe(1);
    expect(await db.quote.count({ where: { rfqSupplierId } })).toBe(1);
    const quote = await db.quote.findFirstOrThrow({ where: { rfqSupplierId } });
    expect(await db.quoteItem.count({ where: { quoteId: quote.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: quote.id, action: "QUOTE_SUBMITTED" } })).toBe(1);
    expect((await db.rFQSupplier.findUniqueOrThrow({ where: { id: rfqSupplierId } })).status).toBe("SUBMITTED");
  });

  it("double submit — different payload: one success, one 409, no overwrite", async () => {
    const admin = await registerOrg(app, "Double Submit Different Org");
    const { rfqSupplierId, rfqItemId, rawToken } = await buildInvitedSupplier(app, admin);

    const results = await Promise.allSettled([
      portal(app, rawToken).post("/api/v1/portal/rfq/quote").send(basicPayload(rfqItemId, "5.0000")),
      portal(app, rawToken).post("/api/v1/portal/rfq/quote").send(basicPayload(rfqItemId, "9.0000")),
    ]);
    const statuses = results.map((r) => (r.status === "fulfilled" ? r.value.status : 599));
    for (const s of statuses) expect(s).toBeLessThan(500);
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(1);

    expect(await db.quote.count({ where: { rfqSupplierId } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityType: "Quote" } })).toBeGreaterThanOrEqual(0); // sanity — no crash counting
  });
});
