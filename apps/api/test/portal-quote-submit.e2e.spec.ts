import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createSystemPrismaClient } from "@top/database";
import { AuditService } from "../src/common/audit/audit.service";
import { createTestApp, uniqueEmail } from "./test-app";

/**
 * M3.4 Supplier Portal Phase C — QUOTE SUBMIT: exact transaction, item
 * coverage, Decimal math/totals, audit atomicity (Architecture §28-41,
 * §74-79). Replay semantics live in portal-quote-replay-*.e2e.spec.ts (split
 * across files to stay under the `quote` route's 10/min throttle within any
 * one file's app-lifetime counter).
 */

interface OrgContext {
  accessToken: string;
  organizationId: string;
}

async function registerOrg(app: INestApplication, orgName: string): Promise<OrgContext> {
  const email = uniqueEmail("pqs");
  const password = "correct-horse-battery-staple";
  const res = await request(app.getHttpServer()).post("/api/v1/auth/register").send({ organizationName: orgName, fullName: "Admin", email, password });
  return { accessToken: res.body.accessToken as string, organizationId: res.body.user.organizationId as string };
}

function authed(app: INestApplication, token: string) {
  return {
    get: (url: string) => request(app.getHttpServer()).get(url).set("Authorization", `Bearer ${token}`),
    post: (url: string) => request(app.getHttpServer()).post(url).set("Authorization", `Bearer ${token}`),
  };
}
function portal(app: INestApplication, token: string) {
  return { post: (url: string) => request(app.getHttpServer()).post(url).set("Authorization", `Bearer ${token}`) };
}

const futureDeadline = () => new Date(Date.now() + 7 * 86400000).toISOString();

async function createApprovedPR(app: INestApplication, admin: OrgContext, items: Record<string, unknown>[]) {
  const pr = await authed(app, admin.accessToken).post("/api/v1/purchase-requests").send({ items });
  await authed(app, admin.accessToken).post(`/api/v1/purchase-requests/${pr.body.id}/submit`);
  await authed(app, admin.accessToken).post(`/api/v1/purchase-requests/${pr.body.id}/approve`);
  return pr.body as { id: string; items: Array<{ id: string }> };
}

async function createSupplierActive(app: INestApplication, token: string, companyName = "Test Supplier") {
  const res = await authed(app, token).post("/api/v1/suppliers").send({ companyName });
  return res.body as { id: string; status: string };
}

/** SENT RFQ with N items (default 2, for coverage tests), one INVITED RFQSupplier. */
async function buildInvitedSupplier(app: INestApplication, admin: OrgContext, itemCount = 2) {
  const items = Array.from({ length: itemCount }, (_, i) => ({ itemName: `Item ${i}`, quantity: "3.500", uomCode: "PCS" }));
  const pr = await createApprovedPR(app, admin, items);
  const supplier = await createSupplierActive(app, admin.accessToken);
  const rfqRes = await authed(app, admin.accessToken)
    .post("/api/v1/rfqs")
    .send({ purchaseRequestId: pr.id, purchaseRequestItemIds: pr.items.map((i) => i.id), supplierIds: [supplier.id], deadline: futureDeadline() });
  const rfq = rfqRes.body as { id: string; suppliers: Array<{ id: string }> };
  await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/send`);
  const rfqSupplierId = rfq.suppliers[0]!.id;
  const invite = await authed(app, admin.accessToken).post(`/api/v1/rfqs/${rfq.id}/suppliers/${rfqSupplierId}/invite`);
  const rfqItems = await request(app.getHttpServer()).get(`/api/v1/rfqs/${rfq.id}`).set("Authorization", `Bearer ${admin.accessToken}`);
  return { pr, supplier, rfq, rfqSupplierId, rawToken: invite.body.token as string, rfqItems: rfqItems.body.items as Array<{ id: string; quantity: string }> };
}

describe("M3.4 Supplier Portal — QUOTE SUBMIT", () => {
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

  it("creates Quote+QuoteItems, sets RFQSupplier SUBMITTED, audits QUOTE_SUBMITTED, quantity copied from RFQItem (never client-supplied)", async () => {
    const admin = await registerOrg(app, "Submit Basic Org");
    const { rfqSupplierId, rawToken, rfqItems } = await buildInvitedSupplier(app, admin, 1);

    const res = await portal(app, rawToken).post("/api/v1/portal/rfq/quote").send({
      currency: "usd",
      vatRate: "12.00",
      vatIncluded: false,
      deliveryCost: "10.00",
      deliveryIncluded: false,
      leadTimeDays: 5,
      paymentTerms: "Net 30",
      items: [{ rfqItemId: rfqItems[0]!.id, unitPrice: "100.0000" }],
    });
    expect(res.status).toBe(200);
    expect(res.body.currency).toBe("USD");
    expect(res.body.status).toBe("SUBMITTED");
    expect(res.body.items[0].quantity).toBe(rfqItems[0]!.quantity);
    expect(res.body).not.toHaveProperty("payloadHash");

    const row = await db.rFQSupplier.findUniqueOrThrow({ where: { id: rfqSupplierId } });
    expect(row.status).toBe("SUBMITTED");
    const quote = await db.quote.findUniqueOrThrow({ where: { rfqSupplierId }, include: { items: true } });
    expect(quote.items).toHaveLength(1);
    expect(quote.items[0]!.quantity.toString()).toBe(rfqItems[0]!.quantity);
    expect(await db.auditLog.count({ where: { entityId: quote.id, action: "QUOTE_SUBMITTED" } })).toBe(1);

    const auditRow = await db.auditLog.findFirstOrThrow({ where: { entityId: quote.id, action: "QUOTE_SUBMITTED" } });
    expect(auditRow.userId).toBeNull();
    expect(JSON.stringify(auditRow.newValue)).not.toMatch(/[0-9a-f]{64}/); // no raw token/hash-shaped value
  });

  describe("item coverage", () => {
    it("rejects a missing RFQItem (partial quote)", async () => {
      const admin = await registerOrg(app, "Coverage Missing Org");
      const { rawToken, rfqItems } = await buildInvitedSupplier(app, admin, 2);
      const res = await portal(app, rawToken)
        .post("/api/v1/portal/rfq/quote")
        .send({ currency: "USD", vatIncluded: false, deliveryCost: "0", deliveryIncluded: true, items: [{ rfqItemId: rfqItems[0]!.id, unitPrice: "1.0000" }] });
      expect(res.status).toBe(400);
    });

    it("rejects a foreign rfqItemId (from another RFQ)", async () => {
      const admin = await registerOrg(app, "Coverage Foreign Org");
      const a = await buildInvitedSupplier(app, admin, 1);
      const b = await buildInvitedSupplier(app, admin, 1);
      const res = await portal(app, a.rawToken)
        .post("/api/v1/portal/rfq/quote")
        .send({ currency: "USD", vatIncluded: false, deliveryCost: "0", deliveryIncluded: true, items: [{ rfqItemId: b.rfqItems[0]!.id, unitPrice: "1.0000" }] });
      expect(res.status).toBe(400);
    });

    it("rejects a duplicate rfqItemId (schema-level 400)", async () => {
      const admin = await registerOrg(app, "Coverage Duplicate Org");
      const { rawToken, rfqItems } = await buildInvitedSupplier(app, admin, 1);
      const res = await portal(app, rawToken)
        .post("/api/v1/portal/rfq/quote")
        .send({
          currency: "USD",
          vatIncluded: false,
          deliveryCost: "0",
          deliveryIncluded: true,
          items: [
            { rfqItemId: rfqItems[0]!.id, unitPrice: "1.0000" },
            { rfqItemId: rfqItems[0]!.id, unitPrice: "2.0000" },
          ],
        });
      expect(res.status).toBe(400);
    });

    it("rejects same-count-but-one-missing-one-foreign", async () => {
      const admin = await registerOrg(app, "Coverage MixedBad Org");
      const a = await buildInvitedSupplier(app, admin, 2);
      const res = await portal(app, a.rawToken)
        .post("/api/v1/portal/rfq/quote")
        .send({
          currency: "USD",
          vatIncluded: false,
          deliveryCost: "0",
          deliveryIncluded: true,
          items: [
            { rfqItemId: a.rfqItems[0]!.id, unitPrice: "1.0000" },
            { rfqItemId: "00000000-0000-0000-0000-000000000000", unitPrice: "1.0000" },
          ],
        });
      expect(res.status).toBe(400);
    });

    it("rejects quantity supplied by the client — strict schema 400 (unknown field)", async () => {
      const admin = await registerOrg(app, "Coverage Quantity Org");
      const { rawToken, rfqItems } = await buildInvitedSupplier(app, admin, 1);
      const res = await portal(app, rawToken)
        .post("/api/v1/portal/rfq/quote")
        .send({
          currency: "USD",
          vatIncluded: false,
          deliveryCost: "0",
          deliveryIncluded: true,
          items: [{ rfqItemId: rfqItems[0]!.id, unitPrice: "1.0000", quantity: "999" }],
        });
      expect(res.status).toBe(400);
    });

    it("accepts full coverage of all RFQ items", async () => {
      const admin = await registerOrg(app, "Coverage Full Org");
      const { rawToken, rfqItems } = await buildInvitedSupplier(app, admin, 2);
      const res = await portal(app, rawToken)
        .post("/api/v1/portal/rfq/quote")
        .send({
          currency: "USD",
          vatIncluded: false,
          deliveryCost: "0",
          deliveryIncluded: true,
          items: rfqItems.map((i, idx) => ({ rfqItemId: i.id, unitPrice: `${idx + 1}.0000` })),
        });
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
    });
  });

  describe("Decimal math / totals — no JS float", () => {
    it("computes exact lineSubtotal/subtotal/totalBeforeVat with awkward decimals (0.1+0.2-shaped values)", async () => {
      const admin = await registerOrg(app, "Decimal Awkward Org");
      const { rawToken, rfqItems } = await buildInvitedSupplier(app, admin, 1);
      // quantity is server-authoritative (3.500 per buildInvitedSupplier) — choose a unitPrice that would expose float error if misused.
      const res = await portal(app, rawToken)
        .post("/api/v1/portal/rfq/quote")
        .send({ currency: "USD", vatIncluded: false, deliveryCost: "0.20", deliveryIncluded: false, items: [{ rfqItemId: rfqItems[0]!.id, unitPrice: "0.1000" }] });
      expect(res.status).toBe(200);
      // 0.1000 * 3.500 = 0.35 exactly (Decimal) — never a float artifact like
      // 0.34999999999999997. decimal.js's arithmetic result keeps only the
      // genuinely significant digits (empirically confirmed — it does not
      // zero-pad to the combined operand scale), so "0.35", not "0.35000".
      expect(res.body.items[0].lineSubtotal).toBe("0.35");
      expect(res.body.subtotal).toBe("0.35");
      expect(res.body.totalBeforeVat).toBe("0.55");
      expect(res.body.totalBeforeVat).not.toContain("999999");
      expect(res.body.totalBeforeVat).not.toContain("000000000000");
    });

    it("computes exact totals across multiple items with different precision, matching manual Decimal sums", async () => {
      const admin = await registerOrg(app, "Decimal Multi Org");
      const { rawToken, rfqItems } = await buildInvitedSupplier(app, admin, 2);
      const res = await portal(app, rawToken)
        .post("/api/v1/portal/rfq/quote")
        .send({
          currency: "USD",
          vatIncluded: false,
          deliveryCost: "15.50",
          deliveryIncluded: false,
          items: [
            { rfqItemId: rfqItems[0]!.id, unitPrice: "10.5000" },
            { rfqItemId: rfqItems[1]!.id, unitPrice: "3.3333" },
          ],
        });
      expect(res.status).toBe(200);
      // Both items have quantity 3.500 (buildInvitedSupplier default).
      // 10.5000 * 3.500 = 36.75 exactly — no genuinely significant digits
      // beyond that, so decimal.js reports "36.75", not "36.75000".
      // 3.3333 * 3.500 = 11.66655 exactly — here every digit IS significant,
      // so decimal.js keeps them all.
      expect(res.body.items[0].lineSubtotal).toBe("36.75");
      expect(res.body.items[1].lineSubtotal).toBe("11.66655");
      expect(res.body.subtotal).toBe("48.41655");
      expect(res.body.totalBeforeVat).toBe("63.91655");
    });
  });
});
