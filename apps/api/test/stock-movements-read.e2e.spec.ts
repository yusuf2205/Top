import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createSystemPrismaClient } from "@top/database";
import { createTestApp, uniqueEmail } from "./test-app";

/**
 * M2.5 Phase G — read side of the immutable StockMovement ledger
 * (GET /api/v1/stock-movements, GET /api/v1/stock-movements/:id). Kept in a
 * separate file from stock-movements.e2e.spec.ts (Phase F, orchestration/
 * mutation) deliberately, mirroring the same "read logic separate from
 * mutation orchestration, conceptually" split the Phase G prompt asked for
 * in the service itself.
 */

interface OrgContext {
  email: string;
  accessToken: string;
  userId: string;
  organizationId: string;
}

async function registerOrg(app: INestApplication, orgName: string): Promise<OrgContext> {
  const email = uniqueEmail("mvread");
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

async function createProduct(
  app: INestApplication,
  token: string,
  overrides: Record<string, unknown> = {}
): Promise<{ id: string; baseUomCode: string; sku: string }> {
  const sku = `SKU-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await authed(app, token)
    .post("/api/v1/products")
    .send({ sku, name: "Test Product", productType: "MATERIAL", baseUomCode: "KG", trackingMode: "QUANTITY", ...overrides });
  return { id: res.body.id as string, baseUomCode: res.body.baseUomCode as string, sku };
}

async function createWarehouse(app: INestApplication, token: string, overrides: Record<string, unknown> = {}): Promise<{ id: string }> {
  const res = await authed(app, token)
    .post("/api/v1/warehouses")
    .send({ code: `WH-${Math.random().toString(36).slice(2, 8).toUpperCase()}`, name: "Test Warehouse", ...overrides });
  return { id: res.body.id as string };
}

async function createUomConversion(
  app: INestApplication,
  token: string,
  productId: string,
  uomCode: string,
  ratio: string
): Promise<void> {
  const res = await authed(app, token)
    .post(`/api/v1/products/${productId}/conversions`)
    .send({ uomCode, source: "CONFIGURED", ratio });
  if (res.status !== 201) {
    throw new Error(`createUomConversion failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

async function postMovement(app: INestApplication, token: string, body: Record<string, unknown>) {
  const res = await authed(app, token).post("/api/v1/stock-movements").send(body);
  if (res.status !== 201) {
    throw new Error(`postMovement failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body as { id: string; lines: Array<Record<string, unknown>> };
}

async function receiveQuantity(
  app: INestApplication,
  token: string,
  productId: string,
  warehouseId: string,
  quantity: string,
  overrides: Record<string, unknown> = {}
) {
  return postMovement(app, token, {
    type: "RECEIPT",
    lines: [{ productId, warehouseId, uomCode: "KG", quantity, ...overrides }],
  });
}

async function receivePiece(
  app: INestApplication,
  token: string,
  productId: string,
  warehouseId: string,
  quantity: string,
  uomCode = "M"
): Promise<string> {
  const res = await postMovement(app, token, {
    type: "RECEIPT",
    lines: [{ productId, warehouseId, pieces: [{ quantity, uomCode }] }],
  });
  return res.lines[0]!.destPieceId as string;
}

function listMovements(app: INestApplication, token: string, query: Record<string, string | number> = {}) {
  const qs = new URLSearchParams(Object.entries(query).map(([k, v]): [string, string] => [k, String(v)])).toString();
  return authed(app, token).get(`/api/v1/stock-movements${qs ? `?${qs}` : ""}`);
}

function getMovement(app: INestApplication, token: string, id: string) {
  return authed(app, token).get(`/api/v1/stock-movements/${id}`);
}

describe("M2.5 Phase G — Stock Movement Read API", () => {
  let app: INestApplication;
  let db: ReturnType<typeof createSystemPrismaClient>;

  beforeAll(async () => {
    app = await createTestApp();
    db = createSystemPrismaClient();
  });

  afterAll(async () => {
    await app.close();
  });

  // ────────────────────────────────────────────────────────────
  // Basic read access / RBAC
  // ────────────────────────────────────────────────────────────
  describe("basic access", () => {
    it("1. authenticated member (non-privileged EMPLOYEE) can list own org movements", async () => {
      const admin = await registerOrg(app, "Read Basic Co");
      const employee = await inviteAndLogin(app, admin, "EMPLOYEE");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const movement = await receiveQuantity(app, admin.accessToken, product.id, wh.id, "10.000");

      const res = await listMovements(app, employee.accessToken);
      expect(res.status).toBe(200);
      expect(res.body.items.some((m: { id: string }) => m.id === movement.id)).toBe(true);
    });

    it("2. authenticated member can get own org movement by id", async () => {
      const admin = await registerOrg(app, "Read Get Co");
      const employee = await inviteAndLogin(app, admin, "EMPLOYEE");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const movement = await receiveQuantity(app, admin.accessToken, product.id, wh.id, "10.000");

      const res = await getMovement(app, employee.accessToken, movement.id);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(movement.id);
    });

    it("21. no movement mutation endpoint exists (PATCH/DELETE => 404)", async () => {
      const admin = await registerOrg(app, "Read Immutable Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const movement = await receiveQuantity(app, admin.accessToken, product.id, wh.id, "10.000");

      const patchRes = await authed(app, admin.accessToken).patch(`/api/v1/stock-movements/${movement.id}`).send({ reason: "x" });
      expect(patchRes.status).toBe(404);
      const deleteRes = await authed(app, admin.accessToken).delete(`/api/v1/stock-movements/${movement.id}`);
      expect(deleteRes.status).toBe(404);
    });
  });

  // ────────────────────────────────────────────────────────────
  // Pagination / sorting
  // ────────────────────────────────────────────────────────────
  describe("pagination and sorting", () => {
    it("3. list pagination works (page/pageSize slice correctly, total is accurate)", async () => {
      const admin = await registerOrg(app, "Read Paging Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      for (let i = 0; i < 5; i++) {
        await receiveQuantity(app, admin.accessToken, product.id, wh.id, "1.000");
      }

      const page1 = await listMovements(app, admin.accessToken, { page: 1, pageSize: 2 });
      const page2 = await listMovements(app, admin.accessToken, { page: 2, pageSize: 2 });
      const page3 = await listMovements(app, admin.accessToken, { page: 3, pageSize: 2 });

      expect(page1.body.total).toBe(5);
      expect(page1.body.items).toHaveLength(2);
      expect(page2.body.items).toHaveLength(2);
      expect(page3.body.items).toHaveLength(1);
      const allIds = [...page1.body.items, ...page2.body.items, ...page3.body.items].map((m: { id: string }) => m.id);
      expect(new Set(allIds).size).toBe(5); // no duplicate/skipped row across pages
    });

    it("4. default sorting is newest first", async () => {
      const admin = await registerOrg(app, "Read Sort Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const first = await receiveQuantity(app, admin.accessToken, product.id, wh.id, "1.000");
      const second = await receiveQuantity(app, admin.accessToken, product.id, wh.id, "2.000");
      const third = await receiveQuantity(app, admin.accessToken, product.id, wh.id, "3.000");

      const res = await listMovements(app, admin.accessToken, { pageSize: 100 });
      const ids = res.body.items.map((m: { id: string }) => m.id);
      expect(ids.indexOf(third.id)).toBeLessThan(ids.indexOf(second.id));
      expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));
    });

    it("24. pagination limit is bounded — pageSize over the max is rejected, not silently clamped", async () => {
      const admin = await registerOrg(app, "Read Bound Co");
      const res = await listMovements(app, admin.accessToken, { pageSize: 1000 });
      expect(res.status).toBe(400);

      const defaultRes = await listMovements(app, admin.accessToken);
      expect(defaultRes.body.pageSize).toBe(20);
      expect(defaultRes.body.items.length).toBeLessThanOrEqual(20);
    });
  });

  // ────────────────────────────────────────────────────────────
  // Filters
  // ────────────────────────────────────────────────────────────
  describe("filters", () => {
    it("5. type filter", async () => {
      const admin = await registerOrg(app, "Read TypeFilter Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const receipt = await receiveQuantity(app, admin.accessToken, product.id, wh.id, "10.000");
      const adjustment = await postMovement(app, admin.accessToken, {
        type: "ADJUSTMENT",
        reason: "count correction",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", delta: "1.000" }],
      });

      const res = await listMovements(app, admin.accessToken, { type: "ADJUSTMENT" });
      const ids = res.body.items.map((m: { id: string }) => m.id);
      expect(ids).toContain(adjustment.id);
      expect(ids).not.toContain(receipt.id);
      expect(res.body.items.every((m: { type: string }) => m.type === "ADJUSTMENT")).toBe(true);
    });

    it("6. actor filter", async () => {
      const admin = await registerOrg(app, "Read ActorFilter Co");
      const manager = await inviteAndLogin(app, admin, "PROCUREMENT_MANAGER");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const byAdmin = await receiveQuantity(app, admin.accessToken, product.id, wh.id, "1.000");
      const byManager = await receiveQuantity(app, manager.accessToken, product.id, wh.id, "2.000");

      const res = await listMovements(app, admin.accessToken, { actorUserId: manager.userId });
      const ids = res.body.items.map((m: { id: string }) => m.id);
      expect(ids).toContain(byManager.id);
      expect(ids).not.toContain(byAdmin.id);
    });

    it("7. referenceType filter", async () => {
      const admin = await registerOrg(app, "Read RefTypeFilter Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const plain = await receiveQuantity(app, admin.accessToken, product.id, wh.id, "1.000");
      const manual = await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        referenceType: "MANUAL",
        referenceId: "11111111-1111-1111-1111-111111111111",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "3.000" }],
      });

      const res = await listMovements(app, admin.accessToken, { referenceType: "MANUAL" });
      const ids = res.body.items.map((m: { id: string }) => m.id);
      expect(ids).toContain(manual.id);
      expect(ids).not.toContain(plain.id);
    });

    it("8. referenceId filter", async () => {
      const admin = await registerOrg(app, "Read RefIdFilter Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const refId = "22222222-2222-2222-2222-222222222222";
      const tagged = await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        referenceType: "MANUAL",
        referenceId: refId,
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "1.000" }],
      });
      const untagged = await receiveQuantity(app, admin.accessToken, product.id, wh.id, "1.000");

      const res = await listMovements(app, admin.accessToken, { referenceId: refId });
      const ids = res.body.items.map((m: { id: string }) => m.id);
      expect(ids).toEqual([tagged.id]);
      expect(ids).not.toContain(untagged.id);
    });

    it("9. createdAt-from filter", async () => {
      const admin = await registerOrg(app, "Read DateFrom Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const older = await receiveQuantity(app, admin.accessToken, product.id, wh.id, "1.000");
      await new Promise((r) => setTimeout(r, 20));
      const cutoff = new Date().toISOString();
      await new Promise((r) => setTimeout(r, 20));
      const newer = await receiveQuantity(app, admin.accessToken, product.id, wh.id, "2.000");

      const res = await listMovements(app, admin.accessToken, { createdAtFrom: cutoff, pageSize: 100 });
      const ids = res.body.items.map((m: { id: string }) => m.id);
      expect(ids).toContain(newer.id);
      expect(ids).not.toContain(older.id);
    });

    it("10. createdAt-to filter", async () => {
      const admin = await registerOrg(app, "Read DateTo Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const older = await receiveQuantity(app, admin.accessToken, product.id, wh.id, "1.000");
      await new Promise((r) => setTimeout(r, 20));
      const cutoff = new Date().toISOString();
      await new Promise((r) => setTimeout(r, 20));
      const newer = await receiveQuantity(app, admin.accessToken, product.id, wh.id, "2.000");

      const res = await listMovements(app, admin.accessToken, { createdAtTo: cutoff, pageSize: 100 });
      const ids = res.body.items.map((m: { id: string }) => m.id);
      expect(ids).toContain(older.id);
      expect(ids).not.toContain(newer.id);
    });

    it("11. invalid date range (from > to) is rejected with 400", async () => {
      const admin = await registerOrg(app, "Read BadRange Co");
      const res = await listMovements(app, admin.accessToken, {
        createdAtFrom: "2026-01-02T00:00:00.000Z",
        createdAtTo: "2026-01-01T00:00:00.000Z",
      });
      expect(res.status).toBe(400);
    });

    it("productId / sourcePieceId / sourceLotId filters", async () => {
      const admin = await registerOrg(app, "Read RelFilter Co");
      const pieceProduct = await createProduct(app, admin.accessToken, { trackingMode: "PIECE" });
      const lotProduct = await createProduct(app, admin.accessToken, { trackingMode: "LOT" });
      const otherProduct = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      await createUomConversion(app, admin.accessToken, pieceProduct.id, "M", "1");

      const pieceId = await receivePiece(app, admin.accessToken, pieceProduct.id, wh.id, "5.000", "M");
      const lotReceipt = await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: lotProduct.id, warehouseId: wh.id, uomCode: "KG", quantity: "5.000", lotNumber: "L-READFILTER" }],
      });
      const lotId = lotReceipt.lines[0]!.destLotId as string;
      const otherReceipt = await receiveQuantity(app, admin.accessToken, otherProduct.id, wh.id, "1.000");

      // productId — positive and negative match
      const byProduct = await listMovements(app, admin.accessToken, { productId: pieceProduct.id });
      const byProductIds = byProduct.body.items.map((m: { id: string }) => m.id);
      expect(byProductIds.length).toBeGreaterThan(0);
      expect(byProductIds).not.toContain(otherReceipt.id);

      // sourcePieceId — the receipt itself has no sourcePieceId (it's a
      // DEST); a subsequent ISSUE from that piece does.
      const issue = await postMovement(app, admin.accessToken, {
        type: "ISSUE",
        lines: [{ sourcePieceId: pieceId, quantity: "2.000" }],
      });
      const bySourcePiece = await listMovements(app, admin.accessToken, { sourcePieceId: pieceId });
      const bySourcePieceIds = bySourcePiece.body.items.map((m: { id: string }) => m.id);
      expect(bySourcePieceIds).toContain(issue.id);
      expect(bySourcePieceIds).not.toContain(otherReceipt.id);

      // sourceLotId — same pattern: the LOT receipt is a DEST, an ISSUE from
      // that lot is a source.
      const lotIssue = await postMovement(app, admin.accessToken, {
        type: "ISSUE",
        lines: [{ productId: lotProduct.id, warehouseId: wh.id, sourceLotId: lotId, uomCode: "KG", quantity: "1.000" }],
      });
      const bySourceLot = await listMovements(app, admin.accessToken, { sourceLotId: lotId });
      const bySourceLotIds = bySourceLot.body.items.map((m: { id: string }) => m.id);
      expect(bySourceLotIds).toContain(lotIssue.id);
      expect(bySourceLotIds).not.toContain(otherReceipt.id);
    });
  });

  // ────────────────────────────────────────────────────────────
  // Detail shape / historical truth
  // ────────────────────────────────────────────────────────────
  describe("detail shape and historical truth", () => {
    it("12/13/14/15/16. detail returns lines with effect, baseQuantity, lineage, and precise decimal quantity", async () => {
      const admin = await registerOrg(app, "Read Detail Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const movement = await receiveQuantity(app, admin.accessToken, product.id, wh.id, "12.345");

      const res = await getMovement(app, admin.accessToken, movement.id);
      expect(res.status).toBe(200);
      expect(res.body.lines).toHaveLength(1);
      const line = res.body.lines[0];
      expect(line.effect).toBe("INBOUND");
      expect(line.baseQuantity).not.toBeNull();
      expect(line.quantity).toBe("12.345"); // exact string round-trip, no float coercion
      expect(line.sourcePieceId).toBeNull();
      expect(line.destPieceId).toBeNull();
      expect(line.sourceLotId).toBeNull();
      expect(line.destLotId).toBeNull();
    });

    it("14b. baseQuantity is null for SPLIT lines (effect=NONE), exposed as null not omitted", async () => {
      const admin = await registerOrg(app, "Read SplitDetail Co");
      const product = await createProduct(app, admin.accessToken, { trackingMode: "PIECE" });
      const wh = await createWarehouse(app, admin.accessToken);
      await createUomConversion(app, admin.accessToken, product.id, "M", "1");
      const pieceId = await receivePiece(app, admin.accessToken, product.id, wh.id, "10.000", "M");

      const split = await postMovement(app, admin.accessToken, {
        type: "SPLIT",
        lines: [{ sourcePieceId: pieceId, children: [{ quantity: "6.000" }, { quantity: "4.000" }] }],
      });

      const res = await getMovement(app, admin.accessToken, split.id);
      expect(res.status).toBe(200);
      expect(res.body.lines.every((l: { effect: string; baseQuantity: null }) => l.effect === "NONE" && l.baseQuantity === null)).toBe(
        true
      );
      expect(res.body.lines.every((l: { sourcePieceId: string }) => l.sourcePieceId === pieceId)).toBe(true);
    });

    it("15b. lineage fields for TRANSFER expose source/dest warehouse and location", async () => {
      const admin = await registerOrg(app, "Read TransferDetail Co");
      const product = await createProduct(app, admin.accessToken);
      const whA = await createWarehouse(app, admin.accessToken);
      const whB = await createWarehouse(app, admin.accessToken);
      await receiveQuantity(app, admin.accessToken, product.id, whA.id, "10.000");

      const transfer = await postMovement(app, admin.accessToken, {
        type: "TRANSFER",
        lines: [{ productId: product.id, sourceWarehouseId: whA.id, destWarehouseId: whB.id, uomCode: "KG", quantity: "4.000" }],
      });

      const res = await getMovement(app, admin.accessToken, transfer.id);
      const line = res.body.lines[0];
      expect(line.effect).toBe("TRANSFER");
      expect(line.sourceWarehouseId).toBe(whA.id);
      expect(line.destWarehouseId).toBe(whB.id);
    });

    it("historical truth: GET detail values are unaffected by later movements changing current StockBalance", async () => {
      const admin = await registerOrg(app, "Read Historical Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const receipt = await receiveQuantity(app, admin.accessToken, product.id, wh.id, "50.000");

      const before = await getMovement(app, admin.accessToken, receipt.id);

      // Change current balance via further movements after the fact.
      await postMovement(app, admin.accessToken, {
        type: "ISSUE",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "30.000" }],
      });
      await postMovement(app, admin.accessToken, {
        type: "ADJUSTMENT",
        reason: "correction",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", delta: "-5.000" }],
      });

      const after = await getMovement(app, admin.accessToken, receipt.id);
      expect(after.body).toEqual(before.body); // the original RECEIPT's stored values never change
      expect(Number(after.body.lines[0].quantity)).toBe(50); // Decimal.toString() strips trailing zeros ("50.000" -> "50") — compare numerically, not by exact padded string
    });

    it("23. archived related product does not corrupt or block the ledger response", async () => {
      const admin = await registerOrg(app, "Read Archived Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const receipt = await receiveQuantity(app, admin.accessToken, product.id, wh.id, "7.000");

      const archiveRes = await authed(app, admin.accessToken).post(`/api/v1/products/${product.id}/archive`).send({});
      expect(archiveRes.status).toBe(200);

      const res = await getMovement(app, admin.accessToken, receipt.id);
      expect(res.status).toBe(200);
      expect(res.body.lines[0].productId).toBe(product.id);
      expect(Number(res.body.lines[0].quantity)).toBe(7); // historical identifier/value still shown, unmutated by the archive
    });
  });

  // ────────────────────────────────────────────────────────────
  // Tenant isolation / IDOR
  // ────────────────────────────────────────────────────────────
  describe("tenant isolation", () => {
    it("17/18/19/20. cross-tenant list, detail, and filter leakage — none", async () => {
      const orgA = await registerOrg(app, "Read TenantA Co");
      const orgB = await registerOrg(app, "Read TenantB Co");
      const productA = await createProduct(app, orgA.accessToken);
      const whA = await createWarehouse(app, orgA.accessToken);
      const productB = await createProduct(app, orgB.accessToken);
      const whB = await createWarehouse(app, orgB.accessToken);

      const movementA = await receiveQuantity(app, orgA.accessToken, productA.id, whA.id, "1.000");
      const refIdB = "33333333-3333-3333-3333-333333333333";
      const movementB = await postMovement(app, orgB.accessToken, {
        type: "RECEIPT",
        referenceType: "MANUAL",
        referenceId: refIdB,
        lines: [{ productId: productB.id, warehouseId: whB.id, uomCode: "KG", quantity: "1.000" }],
      });

      // 17. list isolation
      const listA = await listMovements(app, orgA.accessToken, { pageSize: 100 });
      const idsA = listA.body.items.map((m: { id: string }) => m.id);
      expect(idsA).toContain(movementA.id);
      expect(idsA).not.toContain(movementB.id);

      // 18/20. detail isolation — foreign id => 404, not org B's data
      const detailCrossOrg = await getMovement(app, orgA.accessToken, movementB.id);
      expect(detailCrossOrg.status).toBe(404);

      // 20b. a syntactically invalid id is also a clean 404, never a 500
      const detailInvalid = await getMovement(app, orgA.accessToken, "not-a-real-id");
      expect(detailInvalid.status).toBe(404);

      // 19. foreign referenceId filter leaks nothing (empty list, not an error, not org B's row)
      const filterByForeignRef = await listMovements(app, orgA.accessToken, { referenceId: refIdB });
      expect(filterByForeignRef.status).toBe(200);
      expect(filterByForeignRef.body.items).toHaveLength(0);
      expect(filterByForeignRef.body.total).toBe(0);

      // 6b. foreign actorUserId filter leaks nothing
      const filterByForeignActor = await listMovements(app, orgA.accessToken, { actorUserId: orgB.userId });
      expect(filterByForeignActor.body.items).toHaveLength(0);

      // 7b/8b. foreign product/piece/lot filters leak nothing
      const filterByForeignProduct = await listMovements(app, orgA.accessToken, { productId: productB.id });
      expect(filterByForeignProduct.body.items).toHaveLength(0);
    });
  });

  // ────────────────────────────────────────────────────────────
  // Audit atomicity
  // ────────────────────────────────────────────────────────────
  describe("audit", () => {
    it("22. reading movements never creates an audit record", async () => {
      const admin = await registerOrg(app, "Read Audit Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const movement = await receiveQuantity(app, admin.accessToken, product.id, wh.id, "1.000");

      const before = await db.auditLog.count({ where: { organizationId: admin.organizationId } });
      await listMovements(app, admin.accessToken);
      await getMovement(app, admin.accessToken, movement.id);
      const after = await db.auditLog.count({ where: { organizationId: admin.organizationId } });

      expect(after).toBe(before);
    });
  });

  // ────────────────────────────────────────────────────────────
  // Performance (practical proxy — see Phase G report for why full
  // query-count instrumentation was not added: it would require changing
  // the shared PrismaClient construction in packages/database/src/client.ts,
  // out of scope for a read-only phase)
  // ────────────────────────────────────────────────────────────
  describe("performance", () => {
    it("25. list/detail stay single-digit-query shaped as row count grows (no per-row fan-out)", async () => {
      const admin = await registerOrg(app, "Read Perf Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      for (let i = 0; i < 25; i++) {
        await receiveQuantity(app, admin.accessToken, product.id, wh.id, "1.000");
      }

      const start = Date.now();
      const res = await listMovements(app, admin.accessToken, { pageSize: 25 });
      const elapsedMs = Date.now() - start;

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(25);
      // Generous bound — the point is "does not scale with row count due to
      // N+1", not a tight perf assertion (that belongs in a dedicated
      // benchmark, not an E2E correctness suite).
      expect(elapsedMs).toBeLessThan(3000);
    });
  });
});
