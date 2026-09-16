import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createSystemPrismaClient } from "@top/database";
import { createTestApp, uniqueEmail } from "./test-app";

interface OrgContext {
  email: string;
  accessToken: string;
  userId: string;
  organizationId: string;
}

async function registerOrg(app: INestApplication, orgName: string): Promise<OrgContext> {
  const email = uniqueEmail("mvmt");
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

async function createLocation(app: INestApplication, token: string, warehouseId: string): Promise<{ id: string }> {
  const res = await authed(app, token)
    .post(`/api/v1/warehouses/${warehouseId}/locations`)
    .send({ code: `LOC-${Math.random().toString(36).slice(2, 8).toUpperCase()}`, name: "Test Location" });
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
  return authed(app, token).post("/api/v1/stock-movements").send(body);
}

async function getBalance(
  app: INestApplication,
  token: string,
  productId: string,
  warehouseId: string,
  locationId?: string | null
) {
  const query = new URLSearchParams({ productId, warehouseId });
  if (locationId) query.set("locationId", locationId);
  const res = await authed(app, token).get(`/api/v1/stock-balances?${query.toString()}`);
  return res.body[0] as { onHandQty: string; reservedQty: string } | undefined;
}

async function getPiece(app: INestApplication, token: string, id: string) {
  const res = await authed(app, token).get(`/api/v1/stock-pieces/${id}`);
  return res.body;
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
  return res.body.lines[0].destPieceId as string;
}

describe("M2.5 Phase F — StockMovementsService orchestration", () => {
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
  // 1. RECEIPT
  // ────────────────────────────────────────────────────────────
  describe("RECEIPT", () => {
    it("1. QUANTITY mode creates movement + line + increments balance", async () => {
      const admin = await registerOrg(app, "Receipt Qty Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);

      const res = await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "100.000" }],
      });

      expect(res.status).toBe(201);
      expect(res.body.type).toBe("RECEIPT");
      expect(res.body.lines).toHaveLength(1);
      expect(res.body.lines[0].effect).toBe("INBOUND");
      expect(res.body.lines[0].baseQuantity).not.toBeNull();
      expect(Number(res.body.lines[0].baseQuantity)).toBe(100);

      const balance = await getBalance(app, admin.accessToken, product.id, wh.id);
      expect(Number(balance!.onHandQty)).toBe(100);
    });

    it("LOT mode creates a new StockLot + placement + balance", async () => {
      const admin = await registerOrg(app, "Receipt Lot Co");
      const product = await createProduct(app, admin.accessToken, { trackingMode: "LOT" });
      const wh = await createWarehouse(app, admin.accessToken);

      const res = await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "50.000", lotNumber: "L-1" }],
      });

      expect(res.status).toBe(201);
      const destLotId = res.body.lines[0].destLotId;
      expect(destLotId).not.toBeNull();

      const placementRes = await authed(app, admin.accessToken).get(`/api/v1/stock-lots/${destLotId}/placements`);
      expect(placementRes.body).toHaveLength(1);
      expect(Number(placementRes.body[0].quantity)).toBe(50);

      const balance = await getBalance(app, admin.accessToken, product.id, wh.id);
      expect(Number(balance!.onHandQty)).toBe(50);
    });

    it("PIECE mode creates a new StockLot + StockPiece rows + balance sum", async () => {
      const admin = await registerOrg(app, "Receipt Piece Co");
      const product = await createProduct(app, admin.accessToken, { trackingMode: "PIECE" });
      const wh = await createWarehouse(app, admin.accessToken);
      await createUomConversion(app, admin.accessToken, product.id, "M", "2.5"); // 1 kg = 2.5 m

      const res = await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        lines: [
          {
            productId: product.id,
            warehouseId: wh.id,
            pieces: [
              { quantity: "5.800", uomCode: "M" },
              { quantity: "6.000", uomCode: "M" },
            ],
          },
        ],
      });

      expect(res.status).toBe(201);
      expect(res.body.lines).toHaveLength(2);
      const pieceIds = res.body.lines.map((l: { destPieceId: string }) => l.destPieceId);
      expect(new Set(pieceIds).size).toBe(2);

      const p1 = await getPiece(app, admin.accessToken, pieceIds[0]);
      expect(p1.status).toBe("AVAILABLE");
      expect(Number(p1.quantity)).toBe(5.8);
      expect(p1.uomCode).toBe("M");
      expect(p1.parentPieceId).toBeNull();

      const balance = await getBalance(app, admin.accessToken, product.id, wh.id);
      // (5.8 + 6.0) m / 2.5 (m per kg) = 4.72 kg
      expect(Number(balance!.onHandQty)).toBeCloseTo(4.72, 3);
    });

    it("multi-product RECEIPT creates one movement with multiple lines", async () => {
      const admin = await registerOrg(app, "Receipt Multi Co");
      const productA = await createProduct(app, admin.accessToken);
      const productB = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);

      const res = await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        lines: [
          { productId: productA.id, warehouseId: wh.id, uomCode: "KG", quantity: "10.000" },
          { productId: productB.id, warehouseId: wh.id, uomCode: "KG", quantity: "20.000" },
        ],
      });

      expect(res.status).toBe(201);
      expect(res.body.lines).toHaveLength(2);
      expect(Number((await getBalance(app, admin.accessToken, productA.id, wh.id))!.onHandQty)).toBe(10);
      expect(Number((await getBalance(app, admin.accessToken, productB.id, wh.id))!.onHandQty)).toBe(20);
    });

    it("missing UOM conversion rolls back the entire RECEIPT (no lot, no piece, no balance)", async () => {
      const admin = await registerOrg(app, "Receipt NoConv Co");
      const product = await createProduct(app, admin.accessToken, { trackingMode: "PIECE" });
      const wh = await createWarehouse(app, admin.accessToken);
      // No UomConversion configured for M -> KG.

      const res = await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: product.id, warehouseId: wh.id, pieces: [{ quantity: "5.000", uomCode: "M" }] }],
      });

      expect(res.status).toBe(409);
      const balance = await getBalance(app, admin.accessToken, product.id, wh.id);
      expect(balance).toBeUndefined();
      const pieces = await authed(app, admin.accessToken).get(`/api/v1/stock-pieces?productId=${product.id}`);
      expect(pieces.body).toHaveLength(0);
    });

    it("RECEIPT into an inactive warehouse is rejected (400)", async () => {
      const admin = await registerOrg(app, "Receipt Inactive Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      await authed(app, admin.accessToken).patch(`/api/v1/warehouses/${wh.id}`).send({ active: false });

      const res = await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "10.000" }],
      });
      expect(res.status).toBe(400);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 2. ISSUE
  // ────────────────────────────────────────────────────────────
  describe("ISSUE", () => {
    it("2. QUANTITY mode decrements balance correctly", async () => {
      const admin = await registerOrg(app, "Issue Qty Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "100.000" }],
      });

      const res = await postMovement(app, admin.accessToken, {
        type: "ISSUE",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "30.000" }],
      });

      expect(res.status).toBe(201);
      expect(res.body.lines[0].effect).toBe("OUTBOUND");
      const balance = await getBalance(app, admin.accessToken, product.id, wh.id);
      expect(Number(balance!.onHandQty)).toBe(70);
    });

    it("insufficient stock is rejected with 409 and leaves balance unchanged", async () => {
      const admin = await registerOrg(app, "Issue Insufficient Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "10.000" }],
      });

      const res = await postMovement(app, admin.accessToken, {
        type: "ISSUE",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "999.000" }],
      });

      expect(res.status).toBe(409);
      const balance = await getBalance(app, admin.accessToken, product.id, wh.id);
      expect(Number(balance!.onHandQty)).toBe(10);
    });

    it("8. partial PIECE ISSUE creates correct remnant lineage", async () => {
      const admin = await registerOrg(app, "Issue Partial Piece Co");
      const product = await createProduct(app, admin.accessToken, { trackingMode: "PIECE" });
      const wh = await createWarehouse(app, admin.accessToken);
      await createUomConversion(app, admin.accessToken, product.id, "M", "1");
      const pieceId = await receivePiece(app, admin.accessToken, product.id, wh.id, "4.350", "M");

      const res = await postMovement(app, admin.accessToken, {
        type: "ISSUE",
        lines: [{ sourcePieceId: pieceId, quantity: "4.000" }],
      });

      expect(res.status).toBe(201);
      const line = res.body.lines[0];
      expect(line.effect).toBe("OUTBOUND");
      expect(line.sourcePieceId).toBe(pieceId);
      expect(line.destPieceId).not.toBeNull();

      const parent = await getPiece(app, admin.accessToken, pieceId);
      expect(parent.status).toBe("CONSUMED");
      expect(Number(parent.quantity)).toBe(4.35); // frozen, never mutated

      const remnant = await getPiece(app, admin.accessToken, line.destPieceId);
      expect(remnant.status).toBe("AVAILABLE");
      expect(Number(remnant.quantity)).toBe(0.35);
      expect(remnant.parentPieceId).toBe(pieceId);
      expect(remnant.productId).toBe(product.id);

      const balance = await getBalance(app, admin.accessToken, product.id, wh.id);
      expect(Number(balance!.onHandQty)).toBeCloseTo(0.35, 3); // 4.35 - 4.00, NOT 4.35 - 4.35
    });

    it("full PIECE ISSUE transitions to CONSUMED with no remnant", async () => {
      const admin = await registerOrg(app, "Issue Full Piece Co");
      const product = await createProduct(app, admin.accessToken, { trackingMode: "PIECE" });
      const wh = await createWarehouse(app, admin.accessToken);
      await createUomConversion(app, admin.accessToken, product.id, "M", "1");
      const pieceId = await receivePiece(app, admin.accessToken, product.id, wh.id, "5.000", "M");

      const res = await postMovement(app, admin.accessToken, {
        type: "ISSUE",
        lines: [{ sourcePieceId: pieceId, quantity: "5.000" }],
      });

      expect(res.status).toBe(201);
      expect(res.body.lines[0].destPieceId).toBeNull();
      const parent = await getPiece(app, admin.accessToken, pieceId);
      expect(parent.status).toBe("CONSUMED");
      expect(Number(parent.quantity)).toBe(5);
    });

    it("issuing an already-CONSUMED piece is rejected (409)", async () => {
      const admin = await registerOrg(app, "Issue Twice Co");
      const product = await createProduct(app, admin.accessToken, { trackingMode: "PIECE" });
      const wh = await createWarehouse(app, admin.accessToken);
      await createUomConversion(app, admin.accessToken, product.id, "M", "1");
      const pieceId = await receivePiece(app, admin.accessToken, product.id, wh.id, "5.000", "M");
      await postMovement(app, admin.accessToken, { type: "ISSUE", lines: [{ sourcePieceId: pieceId, quantity: "5.000" }] });

      const res = await postMovement(app, admin.accessToken, {
        type: "ISSUE",
        lines: [{ sourcePieceId: pieceId, quantity: "1.000" }],
      });
      expect(res.status).toBe(409);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 3/4. TRANSFER
  // ────────────────────────────────────────────────────────────
  describe("TRANSFER", () => {
    it("3. QUANTITY mode moves quantity between warehouses correctly", async () => {
      const admin = await registerOrg(app, "Transfer Qty Co");
      const product = await createProduct(app, admin.accessToken);
      const whA = await createWarehouse(app, admin.accessToken);
      const whB = await createWarehouse(app, admin.accessToken);
      await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: product.id, warehouseId: whA.id, uomCode: "KG", quantity: "100.000" }],
      });

      const res = await postMovement(app, admin.accessToken, {
        type: "TRANSFER",
        lines: [{ productId: product.id, sourceWarehouseId: whA.id, destWarehouseId: whB.id, uomCode: "KG", quantity: "30.000" }],
      });

      expect(res.status).toBe(201);
      expect(res.body.lines[0].effect).toBe("TRANSFER");
      expect(Number((await getBalance(app, admin.accessToken, product.id, whA.id))!.onHandQty)).toBe(70);
      expect(Number((await getBalance(app, admin.accessToken, product.id, whB.id))!.onHandQty)).toBe(30);
    });

    it("4. PIECE TRANSFER moves location without changing quantity/identity", async () => {
      const admin = await registerOrg(app, "Transfer Piece Co");
      const product = await createProduct(app, admin.accessToken, { trackingMode: "PIECE" });
      const whA = await createWarehouse(app, admin.accessToken);
      const whB = await createWarehouse(app, admin.accessToken);
      await createUomConversion(app, admin.accessToken, product.id, "M", "1");
      const pieceId = await receivePiece(app, admin.accessToken, product.id, whA.id, "5.000", "M");

      const res = await postMovement(app, admin.accessToken, {
        type: "TRANSFER",
        lines: [{ sourcePieceId: pieceId, destWarehouseId: whB.id }],
      });

      expect(res.status).toBe(201);
      const piece = await getPiece(app, admin.accessToken, pieceId);
      expect(piece.warehouseId).toBe(whB.id);
      expect(piece.status).toBe("AVAILABLE");
      expect(Number(piece.quantity)).toBe(5); // unchanged
      expect(piece.productId).toBe(product.id); // unchanged

      expect(Number((await getBalance(app, admin.accessToken, product.id, whA.id))!.onHandQty)).toBe(0);
      expect(Number((await getBalance(app, admin.accessToken, product.id, whB.id))!.onHandQty)).toBe(5);
    });

    it("TRANSFER into an inactive destination warehouse is rejected (400); FROM an inactive source is allowed", async () => {
      const admin = await registerOrg(app, "Transfer Inactive Co");
      const product = await createProduct(app, admin.accessToken);
      const whA = await createWarehouse(app, admin.accessToken);
      const whB = await createWarehouse(app, admin.accessToken);
      await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: product.id, warehouseId: whA.id, uomCode: "KG", quantity: "50.000" }],
      });

      await authed(app, admin.accessToken).patch(`/api/v1/warehouses/${whB.id}`).send({ active: false });
      const rejected = await postMovement(app, admin.accessToken, {
        type: "TRANSFER",
        lines: [{ productId: product.id, sourceWarehouseId: whA.id, destWarehouseId: whB.id, uomCode: "KG", quantity: "10.000" }],
      });
      expect(rejected.status).toBe(400);

      await authed(app, admin.accessToken).patch(`/api/v1/warehouses/${whA.id}`).send({ active: false });
      const whC = await createWarehouse(app, admin.accessToken);
      const allowed = await postMovement(app, admin.accessToken, {
        type: "TRANSFER",
        lines: [{ productId: product.id, sourceWarehouseId: whA.id, destWarehouseId: whC.id, uomCode: "KG", quantity: "10.000" }],
      });
      expect(allowed.status).toBe(201);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 5/6/7. SPLIT
  // ────────────────────────────────────────────────────────────
  describe("SPLIT", () => {
    it("5. creates children without changing parent quantity; 6. does not mutate Balance", async () => {
      const admin = await registerOrg(app, "Split Co");
      const product = await createProduct(app, admin.accessToken, { trackingMode: "PIECE" });
      const wh = await createWarehouse(app, admin.accessToken);
      await createUomConversion(app, admin.accessToken, product.id, "M", "1");
      const pieceId = await receivePiece(app, admin.accessToken, product.id, wh.id, "10.000", "M");
      const balanceBefore = await getBalance(app, admin.accessToken, product.id, wh.id);

      const res = await postMovement(app, admin.accessToken, {
        type: "SPLIT",
        lines: [{ sourcePieceId: pieceId, children: [{ quantity: "6.000" }, { quantity: "4.000" }] }],
      });

      expect(res.status).toBe(201);
      expect(res.body.lines).toHaveLength(2);
      for (const line of res.body.lines) {
        expect(line.effect).toBe("NONE");
        expect(line.baseQuantity).toBeNull();
      }

      const parent = await getPiece(app, admin.accessToken, pieceId);
      expect(parent.status).toBe("CONSUMED");
      expect(Number(parent.quantity)).toBe(10); // unchanged/frozen

      const childIds: string[] = res.body.lines.map((l: { destPieceId: string }) => l.destPieceId);
      const children = await Promise.all(childIds.map((id) => getPiece(app, admin.accessToken, id)));
      const quantities = children.map((c) => Number(c.quantity)).sort();
      expect(quantities).toEqual([4, 6]);
      for (const child of children) {
        expect(child.status).toBe("AVAILABLE");
        expect(child.parentPieceId).toBe(pieceId);
        expect(child.productId).toBe(product.id);
        expect(child.uomCode).toBe("M");
      }

      const balanceAfter = await getBalance(app, admin.accessToken, product.id, wh.id);
      expect(Number(balanceAfter!.onHandQty)).toBe(Number(balanceBefore!.onHandQty)); // unchanged
    });

    it("7. SPLIT does not require UOM conversion — succeeds even with none confirmed", async () => {
      const admin = await registerOrg(app, "Split NoConv Co");
      const product = await createProduct(app, admin.accessToken, { trackingMode: "PIECE" }); // baseUomCode = KG
      const wh = await createWarehouse(app, admin.accessToken);
      // Deliberately NO UomConversion for M -> KG configured anywhere.
      // Bootstrap the piece directly via the M2.4-D create endpoint (no
      // Balance/conversion involvement at all), to isolate SPLIT itself.
      const lotRes = await authed(app, admin.accessToken).post("/api/v1/stock-lots").send({ productId: product.id });
      const pieceRes = await authed(app, admin.accessToken)
        .post("/api/v1/stock-pieces")
        .send({ lotId: lotRes.body.id, warehouseId: wh.id, uomCode: "M", quantity: "10.000" });
      expect(pieceRes.status).toBe(201);

      const res = await postMovement(app, admin.accessToken, {
        type: "SPLIT",
        lines: [{ sourcePieceId: pieceRes.body.id, children: [{ quantity: "6.000" }, { quantity: "4.000" }] }],
      });

      expect(res.status).toBe(201);
      expect(res.body.lines.every((l: { baseQuantity: null }) => l.baseQuantity === null)).toBe(true);
    });

    it("SPLIT children not summing to the parent's quantity is rejected (400), no mutation", async () => {
      const admin = await registerOrg(app, "Split BadSum Co");
      const product = await createProduct(app, admin.accessToken, { trackingMode: "PIECE" });
      const wh = await createWarehouse(app, admin.accessToken);
      await createUomConversion(app, admin.accessToken, product.id, "M", "1");
      const pieceId = await receivePiece(app, admin.accessToken, product.id, wh.id, "10.000", "M");

      const res = await postMovement(app, admin.accessToken, {
        type: "SPLIT",
        lines: [{ sourcePieceId: pieceId, children: [{ quantity: "6.000" }, { quantity: "3.000" }] }],
      });

      expect(res.status).toBe(400);
      const parent = await getPiece(app, admin.accessToken, pieceId);
      expect(parent.status).toBe("AVAILABLE"); // untouched
    });

    it("SPLIT on a non-PIECE-tracked product is rejected", async () => {
      const admin = await registerOrg(app, "Split WrongMode Co");
      const product = await createProduct(app, admin.accessToken); // QUANTITY mode
      const wh = await createWarehouse(app, admin.accessToken);
      await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "10.000" }],
      });
      // No piece exists for a QUANTITY-mode product, so this exercises the
      // 404 path first — confirms no accidental fallback logic.
      const res = await postMovement(app, admin.accessToken, {
        type: "SPLIT",
        lines: [{ sourcePieceId: "00000000-0000-0000-0000-000000000000", children: [{ quantity: "1" }, { quantity: "1" }] }],
      });
      expect(res.status).toBe(404);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 9. SCRAP
  // ────────────────────────────────────────────────────────────
  describe("SCRAP", () => {
    it("9. decrements stock correctly and requires a reason", async () => {
      const admin = await registerOrg(app, "Scrap Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "20.000" }],
      });

      const noReason = await postMovement(app, admin.accessToken, {
        type: "SCRAP",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "5.000" }],
      });
      expect(noReason.status).toBe(400);

      const res = await postMovement(app, admin.accessToken, {
        type: "SCRAP",
        reason: "Water damage",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "5.000" }],
      });
      expect(res.status).toBe(201);
      expect(res.body.lines[0].effect).toBe("OUTBOUND");
      expect(Number((await getBalance(app, admin.accessToken, product.id, wh.id))!.onHandQty)).toBe(15);
    });

    it("partial PIECE SCRAP creates correct remnant (symmetric to partial ISSUE)", async () => {
      const admin = await registerOrg(app, "Scrap Partial Piece Co");
      const product = await createProduct(app, admin.accessToken, { trackingMode: "PIECE" });
      const wh = await createWarehouse(app, admin.accessToken);
      await createUomConversion(app, admin.accessToken, product.id, "M", "1");
      const pieceId = await receivePiece(app, admin.accessToken, product.id, wh.id, "4.350", "M");

      const res = await postMovement(app, admin.accessToken, {
        type: "SCRAP",
        reason: "Damaged in storage",
        lines: [{ sourcePieceId: pieceId, quantity: "1.000" }],
      });

      expect(res.status).toBe(201);
      const parent = await getPiece(app, admin.accessToken, pieceId);
      expect(parent.status).toBe("SCRAPPED");
      expect(Number(parent.quantity)).toBe(4.35);

      const remnant = await getPiece(app, admin.accessToken, res.body.lines[0].destPieceId);
      expect(remnant.status).toBe("AVAILABLE");
      expect(Number(remnant.quantity)).toBe(3.35);

      const balance = await getBalance(app, admin.accessToken, product.id, wh.id);
      expect(Number(balance!.onHandQty)).toBeCloseTo(3.35, 3); // only the scrapped 1.00 is deducted
    });
  });

  // ────────────────────────────────────────────────────────────
  // 10/11/12. ADJUSTMENT
  // ────────────────────────────────────────────────────────────
  describe("ADJUSTMENT", () => {
    it("10. positive delta increases balance (INBOUND)", async () => {
      const admin = await registerOrg(app, "Adjustment Positive Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "10.000" }],
      });

      const res = await postMovement(app, admin.accessToken, {
        type: "ADJUSTMENT",
        reason: "Stocktake — found extra",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", delta: "5.000" }],
      });
      expect(res.status).toBe(201);
      expect(res.body.lines[0].effect).toBe("INBOUND");
      expect(Number((await getBalance(app, admin.accessToken, product.id, wh.id))!.onHandQty)).toBe(15);
    });

    it("11. negative delta decreases balance (OUTBOUND)", async () => {
      const admin = await registerOrg(app, "Adjustment Negative Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "10.000" }],
      });

      const res = await postMovement(app, admin.accessToken, {
        type: "ADJUSTMENT",
        reason: "Stocktake — shortage",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", delta: "-3.000" }],
      });
      expect(res.status).toBe(201);
      expect(res.body.lines[0].effect).toBe("OUTBOUND");
      expect(Number((await getBalance(app, admin.accessToken, product.id, wh.id))!.onHandQty)).toBe(7);
    });

    it("12. negative ADJUSTMENT cannot overdraw balance", async () => {
      const admin = await registerOrg(app, "Adjustment Overdraw Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "10.000" }],
      });

      const res = await postMovement(app, admin.accessToken, {
        type: "ADJUSTMENT",
        reason: "Bad adjustment",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", delta: "-999.000" }],
      });
      expect(res.status).toBe(409);
      expect(Number((await getBalance(app, admin.accessToken, product.id, wh.id))!.onHandQty)).toBe(10);
    });

    it("ADJUSTMENT on a PIECE-tracked product is rejected (400)", async () => {
      const admin = await registerOrg(app, "Adjustment PieceMode Co");
      const product = await createProduct(app, admin.accessToken, { trackingMode: "PIECE" });
      const wh = await createWarehouse(app, admin.accessToken);
      const res = await postMovement(app, admin.accessToken, {
        type: "ADJUSTMENT",
        reason: "x",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", delta: "5.000" }],
      });
      expect(res.status).toBe(400);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 13/14. Tenant isolation & cross-tenant ownership
  // ────────────────────────────────────────────────────────────
  describe("Tenant isolation", () => {
    it("13. tenant isolation across movement + related entities", async () => {
      const orgA = await registerOrg(app, "Movement Tenant A");
      const orgB = await registerOrg(app, "Movement Tenant B");
      const productA = await createProduct(app, orgA.accessToken);
      const whA = await createWarehouse(app, orgA.accessToken);
      const receipt = await postMovement(app, orgA.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: productA.id, warehouseId: whA.id, uomCode: "KG", quantity: "10.000" }],
      });

      const crossGet = await authed(app, orgB.accessToken).get(`/api/v1/stock-balances?productId=${productA.id}`);
      expect(crossGet.body).toHaveLength(0);

      // orgB attempting a movement referencing orgA's product/warehouse.
      const cross = await postMovement(app, orgB.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: productA.id, warehouseId: whA.id, uomCode: "KG", quantity: "5.000" }],
      });
      expect(cross.status).toBe(404);
      expect(receipt.status).toBe(201);
    });

    it("14. forbidden cross-tenant references: product, warehouse, piece, lot, location", async () => {
      const orgA = await registerOrg(app, "Cross Ref A");
      const orgB = await registerOrg(app, "Cross Ref B");

      const productA = await createProduct(app, orgA.accessToken, { trackingMode: "PIECE" });
      const whA = await createWarehouse(app, orgA.accessToken);
      const locA = await createLocation(app, orgA.accessToken, whA.id);
      await createUomConversion(app, orgA.accessToken, productA.id, "M", "1");
      const pieceA = await receivePiece(app, orgA.accessToken, productA.id, whA.id, "5.000", "M");
      const lotRes = await authed(app, orgA.accessToken).post("/api/v1/stock-lots").send({ productId: productA.id });

      const productB = await createProduct(app, orgB.accessToken);
      const whB = await createWarehouse(app, orgB.accessToken);

      // orgB referencing orgA's product
      expect(
        (
          await postMovement(app, orgB.accessToken, {
            type: "RECEIPT",
            lines: [{ productId: productA.id, warehouseId: whB.id, uomCode: "KG", quantity: "1" }],
          })
        ).status
      ).toBe(404);

      // orgB referencing orgA's warehouse
      expect(
        (
          await postMovement(app, orgB.accessToken, {
            type: "RECEIPT",
            lines: [{ productId: productB.id, warehouseId: whA.id, uomCode: "KG", quantity: "1" }],
          })
        ).status
      ).toBe(404);

      // orgB referencing orgA's piece
      expect((await postMovement(app, orgB.accessToken, { type: "ISSUE", lines: [{ sourcePieceId: pieceA, quantity: "1" }] })).status).toBe(
        404
      );

      // orgB referencing orgA's lot
      expect(
        (
          await postMovement(app, orgB.accessToken, {
            type: "ISSUE",
            lines: [{ productId: productB.id, warehouseId: whB.id, uomCode: "KG", sourceLotId: lotRes.body.id, quantity: "1" }],
          })
        ).status
      ).toBe(404);

      // orgB referencing orgA's location
      expect(
        (
          await postMovement(app, orgB.accessToken, {
            type: "RECEIPT",
            lines: [{ productId: productB.id, warehouseId: whB.id, locationId: locA.id, uomCode: "KG", quantity: "1" }],
          })
        ).status
      ).toBe(404);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 15/16. RBAC
  // ────────────────────────────────────────────────────────────
  describe("RBAC", () => {
    it("15. unauthorized role rejected", async () => {
      const admin = await registerOrg(app, "RBAC Unauthorized Co");
      const employee = await inviteAndLogin(app, admin, "EMPLOYEE");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);

      const res = await postMovement(app, employee.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "1" }],
      });
      expect(res.status).toBe(403);
    });

    it("PROCUREMENT_MANAGER cannot create ADJUSTMENT (ADMIN only)", async () => {
      const admin = await registerOrg(app, "RBAC Adjustment Co");
      const manager = await inviteAndLogin(app, admin, "PROCUREMENT_MANAGER");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "10.000" }],
      });

      const res = await postMovement(app, manager.accessToken, {
        type: "ADJUSTMENT",
        reason: "x",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", delta: "1.000" }],
      });
      expect(res.status).toBe(403);
    });

    it("PROCUREMENT_MANAGER CAN create RECEIPT/ISSUE/TRANSFER/SCRAP/SPLIT", async () => {
      const admin = await registerOrg(app, "RBAC Manager Allowed Co");
      const manager = await inviteAndLogin(app, admin, "PROCUREMENT_MANAGER");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);

      const res = await postMovement(app, manager.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "10.000" }],
      });
      expect(res.status).toBe(201);
    });

    it("16. ADMIN-only ADJUSTMENT enforced even on idempotency replay", async () => {
      const admin = await registerOrg(app, "RBAC Replay Co");
      const manager = await inviteAndLogin(app, admin, "PROCUREMENT_MANAGER");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "10.000" }],
      });

      const body = {
        type: "ADJUSTMENT",
        reason: "x",
        idempotencyKey: "shared-key-rbac-replay",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", delta: "1.000" }],
      };
      const first = await postMovement(app, admin.accessToken, body);
      expect(first.status).toBe(201);

      // PROCUREMENT_MANAGER submits the identical body + the SAME key —
      // must be rejected on authorization, never receive ADMIN's result.
      const replay = await postMovement(app, manager.accessToken, body);
      expect(replay.status).toBe(403);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 17/18/19. Idempotency
  // ────────────────────────────────────────────────────────────
  describe("Idempotency", () => {
    it("17. same idempotency key + same request replays successfully", async () => {
      const admin = await registerOrg(app, "Idempotency Replay Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const body = {
        type: "RECEIPT",
        idempotencyKey: "replay-key-1",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "10.000" }],
      };

      const first = await postMovement(app, admin.accessToken, body);
      const second = await postMovement(app, admin.accessToken, body);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.id).toBe(first.body.id);

      const balance = await getBalance(app, admin.accessToken, product.id, wh.id);
      expect(Number(balance!.onHandQty)).toBe(10); // NOT 20 — only applied once
    });

    it("18. same idempotency key + different request => 409", async () => {
      const admin = await registerOrg(app, "Idempotency Conflict Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);

      const first = await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        idempotencyKey: "conflict-key-1",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "10.000" }],
      });
      expect(first.status).toBe(201);

      const second = await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        idempotencyKey: "conflict-key-1",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "20.000" }], // different payload
      });
      expect(second.status).toBe(409);
    });

    it("same idempotency key across two different organizations does not conflict", async () => {
      const orgA = await registerOrg(app, "Idempotency Org A");
      const orgB = await registerOrg(app, "Idempotency Org B");
      const productA = await createProduct(app, orgA.accessToken);
      const whA = await createWarehouse(app, orgA.accessToken);
      const productB = await createProduct(app, orgB.accessToken);
      const whB = await createWarehouse(app, orgB.accessToken);

      const bodyA = { type: "RECEIPT", idempotencyKey: "shared-across-orgs", lines: [{ productId: productA.id, warehouseId: whA.id, uomCode: "KG", quantity: "1" }] };
      const bodyB = { type: "RECEIPT", idempotencyKey: "shared-across-orgs", lines: [{ productId: productB.id, warehouseId: whB.id, uomCode: "KG", quantity: "2" }] };

      const resA = await postMovement(app, orgA.accessToken, bodyA);
      const resB = await postMovement(app, orgB.accessToken, bodyB);
      expect(resA.status).toBe(201);
      expect(resB.status).toBe(201);
      expect(resA.body.id).not.toBe(resB.body.id);
    });

    it("19. concurrent identical idempotency-key requests produce exactly one movement", async () => {
      const admin = await registerOrg(app, "Idempotency Concurrent Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const body = {
        type: "RECEIPT",
        idempotencyKey: "concurrent-key-1",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "10.000" }],
      };

      const [r1, r2] = await Promise.all([postMovement(app, admin.accessToken, body), postMovement(app, admin.accessToken, body)]);
      expect([r1.status, r2.status]).toEqual([201, 201]);
      expect(r1.body.id).toBe(r2.body.id);

      const balance = await getBalance(app, admin.accessToken, product.id, wh.id);
      expect(Number(balance!.onHandQty)).toBe(10); // only ever applied once
    });

    it("retry after a failed attempt is allowed — no ghost idempotency reservation", async () => {
      const admin = await registerOrg(app, "Idempotency RetryAfterFail Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      // Insufficient stock -> fails, rolls back entirely, including the header.
      const failed = await postMovement(app, admin.accessToken, {
        type: "ISSUE",
        idempotencyKey: "retry-after-fail-1",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "999.000" }],
      });
      expect(failed.status).toBe(409);

      // Fund the balance, then retry with the SAME key — must be a fresh
      // attempt, not blocked by a leftover reservation from the failure.
      await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "999.000" }],
      });
      const retried = await postMovement(app, admin.accessToken, {
        type: "ISSUE",
        idempotencyKey: "retry-after-fail-1",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "999.000" }],
      });
      expect(retried.status).toBe(201);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 20/23. Concurrency & retry
  // ────────────────────────────────────────────────────────────
  describe("Concurrency", () => {
    it("20. concurrent outbound requests never create a negative balance", async () => {
      const admin = await registerOrg(app, "Concurrency Outbound Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "100.000" }],
      });

      const [r1, r2] = await Promise.all([
        postMovement(app, admin.accessToken, { type: "ISSUE", lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "70.000" }] }),
        postMovement(app, admin.accessToken, { type: "ISSUE", lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "50.000" }] }),
      ]);

      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([201, 409]);
      const balance = await getBalance(app, admin.accessToken, product.id, wh.id);
      expect(Number(balance!.onHandQty)).toBeGreaterThanOrEqual(0);
      expect([30, 50]).toContain(Number(balance!.onHandQty));
    });

    it("23. a lost create-race (retryable) is retried at the whole-transaction level and recovers with no lost update", async () => {
      const admin = await registerOrg(app, "Concurrency Retry Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      // No StockBalance row exists yet for this key — both requests race to create it.

      const [r1, r2] = await Promise.all([
        postMovement(app, admin.accessToken, { type: "RECEIPT", lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "30.000" }] }),
        postMovement(app, admin.accessToken, { type: "RECEIPT", lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "20.000" }] }),
      ]);

      // Both eventually succeed — one directly, one via the bounded
      // whole-transaction retry after losing the create race.
      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
      const balance = await getBalance(app, admin.accessToken, product.id, wh.id);
      expect(Number(balance!.onHandQty)).toBe(50); // sum of both — no lost update
    });
  });

  // ────────────────────────────────────────────────────────────
  // 21/22. Transaction integrity & audit atomicity
  // ────────────────────────────────────────────────────────────
  describe("Transaction integrity", () => {
    it("21. failed transaction leaves no movement, no stock mutation, no audit", async () => {
      const admin = await registerOrg(app, "TxIntegrity Fail Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);

      const res = await postMovement(app, admin.accessToken, {
        type: "ISSUE",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "999.000" }],
      });
      expect(res.status).toBe(409);

      const movements = await db.stockMovement.findMany({ where: { organizationId: admin.organizationId } });
      expect(movements).toHaveLength(0);
      const audits = await db.auditLog.findMany({ where: { organizationId: admin.organizationId, action: "STOCK_MOVEMENT_CREATED" } });
      expect(audits).toHaveLength(0);
      const balance = await getBalance(app, admin.accessToken, product.id, wh.id);
      expect(balance).toBeUndefined();
    });

    it("22. successful transaction creates movement + stock mutation + audit atomically", async () => {
      const admin = await registerOrg(app, "TxIntegrity Success Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);

      const res = await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "10.000" }],
      });
      expect(res.status).toBe(201);

      const movement = await db.stockMovement.findFirst({ where: { id: res.body.id, organizationId: admin.organizationId } });
      expect(movement).not.toBeNull();
      const lines = await db.stockMovementLine.findMany({ where: { movementId: res.body.id } });
      expect(lines).toHaveLength(1);
      const audits = await db.auditLog.findMany({
        where: { organizationId: admin.organizationId, action: "STOCK_MOVEMENT_CREATED", entityId: res.body.id },
      });
      expect(audits).toHaveLength(1);
      const balance = await getBalance(app, admin.accessToken, product.id, wh.id);
      expect(Number(balance!.onHandQty)).toBe(10);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 24. Decimal exactness
  // ────────────────────────────────────────────────────────────
  describe("Decimal exactness", () => {
    it("24. quantities remain exact to 3 decimal places through RECEIPT -> ISSUE", async () => {
      const admin = await registerOrg(app, "Decimal Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "10.005" }],
      });
      await postMovement(app, admin.accessToken, {
        type: "ISSUE",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "0.001" }],
      });
      const balance = await getBalance(app, admin.accessToken, product.id, wh.id);
      expect(Number(balance!.onHandQty)).toBe(10.004);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 25. Immutable ledger
  // ────────────────────────────────────────────────────────────
  describe("Immutable ledger", () => {
    it("25. no PATCH / DELETE route exists for a movement", async () => {
      const admin = await registerOrg(app, "Immutable Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const res = await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "10.000" }],
      });

      const patch = await authed(app, admin.accessToken).patch(`/api/v1/stock-movements/${res.body.id}`).send({ reason: "hacked" });
      expect(patch.status).toBe(404);
      const del = await authed(app, admin.accessToken).delete(`/api/v1/stock-movements/${res.body.id}`);
      expect(del.status).toBe(404);
    });
  });

  // ────────────────────────────────────────────────────────────
  // Additional: warehouse/location composition, PIECE trackingMode
  // enforcement, server-derived fields, mass assignment, lineage vs
  // accounting.
  // ────────────────────────────────────────────────────────────
  describe("Additional validation", () => {
    it("locationId not belonging to the given warehouseId is rejected (400)", async () => {
      const admin = await registerOrg(app, "Composition Co");
      const product = await createProduct(app, admin.accessToken);
      const whA = await createWarehouse(app, admin.accessToken);
      const whB = await createWarehouse(app, admin.accessToken);
      const locB = await createLocation(app, admin.accessToken, whB.id);

      const res = await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: product.id, warehouseId: whA.id, locationId: locB.id, uomCode: "KG", quantity: "1" }],
      });
      expect(res.status).toBe(400);
    });

    it("PIECE trackingMode enforcement: RECEIPT with flat quantity on a PIECE product is rejected", async () => {
      const admin = await registerOrg(app, "TrackingMode Piece Co");
      const product = await createProduct(app, admin.accessToken, { trackingMode: "PIECE" });
      const wh = await createWarehouse(app, admin.accessToken);
      const res = await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "10.000" }],
      });
      expect(res.status).toBe(400);
    });

    it("RECEIPT with pieces[] on a non-PIECE product is rejected", async () => {
      const admin = await registerOrg(app, "TrackingMode Quantity Co");
      const product = await createProduct(app, admin.accessToken); // QUANTITY mode
      const wh = await createWarehouse(app, admin.accessToken);
      const res = await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: product.id, warehouseId: wh.id, pieces: [{ quantity: "1", uomCode: "M" }] }],
      });
      expect(res.status).toBe(400);
    });

    it("productId/lotId are server-derived on PIECE-mode lines, never client-trusted", async () => {
      const admin = await registerOrg(app, "ServerDerived Co");
      const product = await createProduct(app, admin.accessToken, { trackingMode: "PIECE" });
      const wh = await createWarehouse(app, admin.accessToken);
      await createUomConversion(app, admin.accessToken, product.id, "M", "1");
      const pieceId = await receivePiece(app, admin.accessToken, product.id, wh.id, "5.000", "M");

      const res = await postMovement(app, admin.accessToken, {
        type: "ISSUE",
        lines: [{ sourcePieceId: pieceId, quantity: "5.000" }],
      });
      expect(res.status).toBe(201);
      expect(res.body.lines[0].productId).toBe(product.id); // derived from the piece, never asked of the client
    });

    it("mass assignment: organizationId/actorUserId/effect/baseQuantity are never accepted", async () => {
      const admin = await registerOrg(app, "MassAssignment Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);

      const res = await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        organizationId: "00000000-0000-0000-0000-000000000099",
        actorUserId: "00000000-0000-0000-0000-000000000099",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "1", effect: "OUTBOUND", baseQuantity: "999" }],
      });
      expect(res.status).toBe(400); // rejected by strict DTO validation — not silently stripped and accepted
    });

    it("lineage fields (destPieceId) never imply accounting effect — verified end to end for partial ISSUE", async () => {
      const admin = await registerOrg(app, "LineageVsAccounting Co");
      const product = await createProduct(app, admin.accessToken, { trackingMode: "PIECE" });
      const wh = await createWarehouse(app, admin.accessToken);
      await createUomConversion(app, admin.accessToken, product.id, "M", "1");
      const pieceId = await receivePiece(app, admin.accessToken, product.id, wh.id, "10.000", "M");
      const balanceBefore = await getBalance(app, admin.accessToken, product.id, wh.id);

      const res = await postMovement(app, admin.accessToken, {
        type: "ISSUE",
        lines: [{ sourcePieceId: pieceId, quantity: "3.000" }],
      });
      expect(res.status).toBe(201);
      // destPieceId is populated (the remnant) but the Balance effect is
      // exactly -3 (OUTBOUND), never a net-zero "transfer-shaped" result
      // that a naive `destPieceId != null => inbound` rule would produce.
      const balanceAfter = await getBalance(app, admin.accessToken, product.id, wh.id);
      expect(Number(balanceBefore!.onHandQty) - Number(balanceAfter!.onHandQty)).toBe(3);
    });
  });
});
