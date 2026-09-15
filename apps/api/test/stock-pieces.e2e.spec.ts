import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, uniqueEmail } from "./test-app";

interface OrgContext {
  email: string;
  accessToken: string;
  userId: string;
  organizationId: string;
}

async function registerOrg(app: INestApplication, orgName: string): Promise<OrgContext> {
  const email = uniqueEmail("piece");
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
): Promise<{ id: string; baseUomCode: string }> {
  const res = await authed(app, token)
    .post("/api/v1/products")
    .send({ name: "Test Product", productType: "MATERIAL", baseUomCode: "KG", trackingMode: "PIECE", ...overrides });
  return { id: res.body.id as string, baseUomCode: res.body.baseUomCode as string };
}

async function createWarehouse(app: INestApplication, token: string): Promise<{ id: string }> {
  const res = await authed(app, token)
    .post("/api/v1/warehouses")
    .send({ code: `WH-${Math.random().toString(36).slice(2, 8).toUpperCase()}`, name: "Test Warehouse" });
  return { id: res.body.id as string };
}

async function createLocation(app: INestApplication, token: string, warehouseId: string): Promise<{ id: string }> {
  const res = await authed(app, token)
    .post(`/api/v1/warehouses/${warehouseId}/locations`)
    .send({ code: `LOC-${Math.random().toString(36).slice(2, 8).toUpperCase()}`, name: "Test Location" });
  return { id: res.body.id as string };
}

async function createStockLot(
  app: INestApplication,
  token: string,
  productId: string,
  overrides: Record<string, unknown> = {}
): Promise<{ id: string }> {
  const res = await authed(app, token).post("/api/v1/stock-lots").send({ productId, ...overrides });
  return { id: res.body.id as string };
}

describe("M2.4-D StockPiece", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("Basic create / list / get", () => {
    it("creates a warehouse-level piece (no location)", async () => {
      const admin = await registerOrg(app, "Piece Create Co");
      const product = await createProduct(app, admin.accessToken);
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const wh = await createWarehouse(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/stock-pieces")
        .send({ lotId: lot.id, warehouseId: wh.id, uomCode: "M", quantity: "5.8" });
      expect(res.status).toBe(201);
      expect(res.body.lotId).toBe(lot.id);
      expect(res.body.productId).toBe(product.id);
      expect(res.body.warehouseId).toBe(wh.id);
      expect(res.body.locationId).toBeNull();
      expect(res.body.parentPieceId).toBeNull();
      expect(res.body.status).toBe("AVAILABLE");
      expect(Number(res.body.quantity)).toBe(5.8);
      expect(res.body.uomCode).toBe("M");
    });

    it("creates a location-level piece", async () => {
      const admin = await registerOrg(app, "Piece Create Location Co");
      const product = await createProduct(app, admin.accessToken);
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const wh = await createWarehouse(app, admin.accessToken);
      const loc = await createLocation(app, admin.accessToken, wh.id);
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/stock-pieces")
        .send({ lotId: lot.id, warehouseId: wh.id, locationId: loc.id, uomCode: "M", quantity: "6" });
      expect(res.status).toBe(201);
      expect(res.body.locationId).toBe(loc.id);
    });

    it("lists and reads pieces, filtered by lotId/status", async () => {
      const admin = await registerOrg(app, "Piece List Read Co");
      const product = await createProduct(app, admin.accessToken);
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const wh = await createWarehouse(app, admin.accessToken);
      const created = await authed(app, admin.accessToken)
        .post("/api/v1/stock-pieces")
        .send({ lotId: lot.id, warehouseId: wh.id, uomCode: "M", quantity: "6" });

      const list = await authed(app, admin.accessToken).get(`/api/v1/stock-pieces?lotId=${lot.id}&status=AVAILABLE`);
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(1);

      const get = await authed(app, admin.accessToken).get(`/api/v1/stock-pieces/${created.body.id}`);
      expect(get.status).toBe(200);
      expect(get.body.id).toBe(created.body.id);
    });

    it("allows multiple distinct pieces at the exact same product/warehouse/location", async () => {
      const admin = await registerOrg(app, "Piece Coexist Co");
      const product = await createProduct(app, admin.accessToken);
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const wh = await createWarehouse(app, admin.accessToken);
      const a = await authed(app, admin.accessToken)
        .post("/api/v1/stock-pieces")
        .send({ lotId: lot.id, warehouseId: wh.id, uomCode: "M", quantity: "6" });
      const b = await authed(app, admin.accessToken)
        .post("/api/v1/stock-pieces")
        .send({ lotId: lot.id, warehouseId: wh.id, uomCode: "M", quantity: "5.8" });
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(a.body.id).not.toBe(b.body.id);
    });
  });

  describe("Tenant isolation", () => {
    it("cross-tenant GET on a piece -> 404", async () => {
      const orgA = await registerOrg(app, "Piece Tenant A");
      const orgB = await registerOrg(app, "Piece Tenant B");
      const product = await createProduct(app, orgA.accessToken);
      const lot = await createStockLot(app, orgA.accessToken, product.id);
      const wh = await createWarehouse(app, orgA.accessToken);
      const piece = await authed(app, orgA.accessToken)
        .post("/api/v1/stock-pieces")
        .send({ lotId: lot.id, warehouseId: wh.id, uomCode: "M", quantity: "6" });
      const res = await authed(app, orgB.accessToken).get(`/api/v1/stock-pieces/${piece.body.id}`);
      expect(res.status).toBe(404);
    });
  });

  describe("Lot / Warehouse / Location ownership", () => {
    it("foreign lot (org B) -> 404", async () => {
      const orgA = await registerOrg(app, "Piece Foreign Lot A");
      const orgB = await registerOrg(app, "Piece Foreign Lot B");
      const productB = await createProduct(app, orgB.accessToken);
      const lotB = await createStockLot(app, orgB.accessToken, productB.id);
      const whA = await createWarehouse(app, orgA.accessToken);
      const res = await authed(app, orgA.accessToken)
        .post("/api/v1/stock-pieces")
        .send({ lotId: lotB.id, warehouseId: whA.id, uomCode: "M", quantity: "6" });
      expect(res.status).toBe(404);
    });

    it("foreign warehouse (org B) -> 404", async () => {
      const orgA = await registerOrg(app, "Piece Foreign Wh A");
      const orgB = await registerOrg(app, "Piece Foreign Wh B");
      const product = await createProduct(app, orgA.accessToken);
      const lot = await createStockLot(app, orgA.accessToken, product.id);
      const whB = await createWarehouse(app, orgB.accessToken);
      const res = await authed(app, orgA.accessToken)
        .post("/api/v1/stock-pieces")
        .send({ lotId: lot.id, warehouseId: whB.id, uomCode: "M", quantity: "6" });
      expect(res.status).toBe(404);
    });

    it("foreign location (org B) -> 404", async () => {
      const orgA = await registerOrg(app, "Piece Foreign Loc A");
      const orgB = await registerOrg(app, "Piece Foreign Loc B");
      const product = await createProduct(app, orgA.accessToken);
      const lot = await createStockLot(app, orgA.accessToken, product.id);
      const whA = await createWarehouse(app, orgA.accessToken);
      const whB = await createWarehouse(app, orgB.accessToken);
      const locB = await createLocation(app, orgB.accessToken, whB.id);
      const res = await authed(app, orgA.accessToken)
        .post("/api/v1/stock-pieces")
        .send({ lotId: lot.id, warehouseId: whA.id, locationId: locB.id, uomCode: "M", quantity: "6" });
      expect(res.status).toBe(404);
    });

    it("location belongs to a different (same-org) warehouse -> 400", async () => {
      const admin = await registerOrg(app, "Piece Composition Co");
      const product = await createProduct(app, admin.accessToken);
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const whA = await createWarehouse(app, admin.accessToken);
      const whB = await createWarehouse(app, admin.accessToken);
      const locUnderB = await createLocation(app, admin.accessToken, whB.id);
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/stock-pieces")
        .send({ lotId: lot.id, warehouseId: whA.id, locationId: locUnderB.id, uomCode: "M", quantity: "6" });
      expect(res.status).toBe(400);
    });
  });

  describe("PIECE tracking mode enforcement", () => {
    it("rejects creation for a QUANTITY-tracked product", async () => {
      const admin = await registerOrg(app, "Piece Wrong Mode Quantity Co");
      const product = await createProduct(app, admin.accessToken, { trackingMode: "QUANTITY" });
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const wh = await createWarehouse(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/stock-pieces")
        .send({ lotId: lot.id, warehouseId: wh.id, uomCode: "M", quantity: "6" });
      expect(res.status).toBe(400);
    });

    it("rejects creation for a LOT-tracked product", async () => {
      const admin = await registerOrg(app, "Piece Wrong Mode Lot Co");
      const product = await createProduct(app, admin.accessToken, { trackingMode: "LOT" });
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const wh = await createWarehouse(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/stock-pieces")
        .send({ lotId: lot.id, warehouseId: wh.id, uomCode: "M", quantity: "6" });
      expect(res.status).toBe(400);
    });

    it("allows creation for a PIECE-tracked product", async () => {
      const admin = await registerOrg(app, "Piece Right Mode Co");
      const product = await createProduct(app, admin.accessToken, { trackingMode: "PIECE" });
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const wh = await createWarehouse(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/stock-pieces")
        .send({ lotId: lot.id, warehouseId: wh.id, uomCode: "M", quantity: "6" });
      expect(res.status).toBe(201);
    });
  });

  describe("Positive quantity", () => {
    it("rejects a zero quantity", async () => {
      const admin = await registerOrg(app, "Piece Zero Qty Co");
      const product = await createProduct(app, admin.accessToken);
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const wh = await createWarehouse(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/stock-pieces")
        .send({ lotId: lot.id, warehouseId: wh.id, uomCode: "M", quantity: "0" });
      expect(res.status).toBe(400);
    });

    it("rejects a negative quantity", async () => {
      const admin = await registerOrg(app, "Piece Negative Qty Co");
      const product = await createProduct(app, admin.accessToken);
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const wh = await createWarehouse(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/stock-pieces")
        .send({ lotId: lot.id, warehouseId: wh.id, uomCode: "M", quantity: "-1" });
      expect(res.status).toBe(400);
    });
  });

  describe("UOM acceptance without a confirmed conversion", () => {
    it("accepts a piece uomCode that differs in dimension from the product's baseUomCode, with no UomConversion configured", async () => {
      const admin = await registerOrg(app, "Piece Uom No Conversion Co");
      const product = await createProduct(app, admin.accessToken, { baseUomCode: "KG" });
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const wh = await createWarehouse(app, admin.accessToken);
      // No POST /products/:id/conversions call at all — deliberately no
      // confirmed KG<->M conversion exists for this product.
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/stock-pieces")
        .send({ lotId: lot.id, warehouseId: wh.id, uomCode: "M", quantity: "5.8" });
      expect(res.status).toBe(201);
      expect(res.body.uomCode).toBe("M");
    });
  });

  describe("Mass assignment", () => {
    it("organizationId in the body cannot retarget tenant ownership", async () => {
      const admin = await registerOrg(app, "Piece Mass Assign Org Co");
      const product = await createProduct(app, admin.accessToken);
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const wh = await createWarehouse(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/stock-pieces")
        .send({ lotId: lot.id, warehouseId: wh.id, uomCode: "M", quantity: "6", organizationId: "foreign-org-id" });
      expect(res.status).toBe(201);
      const get = await authed(app, admin.accessToken).get(`/api/v1/stock-pieces/${res.body.id}`);
      expect(get.status).toBe(200);
    });
  });

  describe("productId server derivation", () => {
    it("a productId in the request body is ignored — the piece always takes productId from its lot", async () => {
      const admin = await registerOrg(app, "Piece Product Derive Co");
      const productA = await createProduct(app, admin.accessToken, { name: "A" });
      const productB = await createProduct(app, admin.accessToken, { name: "B" });
      const lotA = await createStockLot(app, admin.accessToken, productA.id);
      const wh = await createWarehouse(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/stock-pieces")
        .send({ lotId: lotA.id, warehouseId: wh.id, uomCode: "M", quantity: "6", productId: productB.id });
      expect(res.status).toBe(201);
      expect(res.body.productId).toBe(productA.id);
    });
  });

  describe("No parentPieceId in normal create", () => {
    it("a client-supplied parentPieceId is ignored — the created piece has no parent", async () => {
      const admin = await registerOrg(app, "Piece No Parent Co");
      const product = await createProduct(app, admin.accessToken);
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const wh = await createWarehouse(app, admin.accessToken);
      const first = await authed(app, admin.accessToken)
        .post("/api/v1/stock-pieces")
        .send({ lotId: lot.id, warehouseId: wh.id, uomCode: "M", quantity: "6" });
      const second = await authed(app, admin.accessToken)
        .post("/api/v1/stock-pieces")
        .send({ lotId: lot.id, warehouseId: wh.id, uomCode: "M", quantity: "4", parentPieceId: first.body.id });
      expect(second.status).toBe(201);
      expect(second.body.parentPieceId).toBeNull();
    });
  });

  describe("No PATCH / No DELETE", () => {
    it("PATCH on a piece is not a defined route (404 from the router, not a business 400/403)", async () => {
      const admin = await registerOrg(app, "Piece No Patch Co");
      const product = await createProduct(app, admin.accessToken);
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const wh = await createWarehouse(app, admin.accessToken);
      const created = await authed(app, admin.accessToken)
        .post("/api/v1/stock-pieces")
        .send({ lotId: lot.id, warehouseId: wh.id, uomCode: "M", quantity: "6" });
      const res = await authed(app, admin.accessToken)
        .patch(`/api/v1/stock-pieces/${created.body.id}`)
        .send({ quantity: "999" });
      expect(res.status).toBe(404);
    });

    it("DELETE on a piece is not a defined route", async () => {
      const admin = await registerOrg(app, "Piece No Delete Co");
      const product = await createProduct(app, admin.accessToken);
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const wh = await createWarehouse(app, admin.accessToken);
      const created = await authed(app, admin.accessToken)
        .post("/api/v1/stock-pieces")
        .send({ lotId: lot.id, warehouseId: wh.id, uomCode: "M", quantity: "6" });
      const res = await authed(app, admin.accessToken).delete(`/api/v1/stock-pieces/${created.body.id}`);
      expect(res.status).toBe(404);
    });
  });

  describe("RBAC", () => {
    it("EMPLOYEE can read but not create", async () => {
      const admin = await registerOrg(app, "Piece RBAC Employee Co");
      const employee = await inviteAndLogin(app, admin, "EMPLOYEE");
      const product = await createProduct(app, admin.accessToken);
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const wh = await createWarehouse(app, admin.accessToken);

      const read = await authed(app, employee.accessToken).get("/api/v1/stock-pieces");
      expect(read.status).toBe(200);

      const write = await authed(app, employee.accessToken)
        .post("/api/v1/stock-pieces")
        .send({ lotId: lot.id, warehouseId: wh.id, uomCode: "M", quantity: "6" });
      expect(write.status).toBe(403);
    });

    it("PROCUREMENT_SPECIALIST cannot create a piece", async () => {
      const admin = await registerOrg(app, "Piece RBAC Specialist Co");
      const specialist = await inviteAndLogin(app, admin, "PROCUREMENT_SPECIALIST");
      const product = await createProduct(app, admin.accessToken);
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const wh = await createWarehouse(app, admin.accessToken);
      const res = await authed(app, specialist.accessToken)
        .post("/api/v1/stock-pieces")
        .send({ lotId: lot.id, warehouseId: wh.id, uomCode: "M", quantity: "6" });
      expect(res.status).toBe(403);
    });

    it("PROCUREMENT_MANAGER can create a piece", async () => {
      const admin = await registerOrg(app, "Piece RBAC Manager Co");
      const manager = await inviteAndLogin(app, admin, "PROCUREMENT_MANAGER");
      const product = await createProduct(app, admin.accessToken);
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const wh = await createWarehouse(app, admin.accessToken);
      const res = await authed(app, manager.accessToken)
        .post("/api/v1/stock-pieces")
        .send({ lotId: lot.id, warehouseId: wh.id, uomCode: "M", quantity: "6" });
      expect(res.status).toBe(201);
    });

    it("APPROVER can read but not write", async () => {
      const admin = await registerOrg(app, "Piece RBAC Approver Co");
      const approver = await inviteAndLogin(app, admin, "APPROVER");
      const product = await createProduct(app, admin.accessToken);
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const wh = await createWarehouse(app, admin.accessToken);
      const res = await authed(app, approver.accessToken)
        .post("/api/v1/stock-pieces")
        .send({ lotId: lot.id, warehouseId: wh.id, uomCode: "M", quantity: "6" });
      expect(res.status).toBe(403);
    });
  });

  describe("No StockBalance / StockLotPlacement mutation", () => {
    it("POST a piece does not create or change StockBalance", async () => {
      const admin = await registerOrg(app, "Piece Consistency Balance Co");
      const product = await createProduct(app, admin.accessToken);
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const wh = await createWarehouse(app, admin.accessToken);

      await authed(app, admin.accessToken)
        .post("/api/v1/stock-pieces")
        .send({ lotId: lot.id, warehouseId: wh.id, uomCode: "M", quantity: "6" });

      const balances = await authed(app, admin.accessToken).get(
        `/api/v1/stock-balances?productId=${product.id}&warehouseId=${wh.id}`
      );
      expect(balances.status).toBe(200);
      expect(balances.body).toHaveLength(0);
    });

    it("POST a piece does not create or change StockLotPlacement rows for its lot", async () => {
      const admin = await registerOrg(app, "Piece Consistency Placement Co");
      const product = await createProduct(app, admin.accessToken);
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const wh = await createWarehouse(app, admin.accessToken);

      await authed(app, admin.accessToken)
        .post("/api/v1/stock-pieces")
        .send({ lotId: lot.id, warehouseId: wh.id, uomCode: "M", quantity: "6" });

      const placements = await authed(app, admin.accessToken).get(`/api/v1/stock-lots/${lot.id}/placements`);
      expect(placements.status).toBe(200);
      expect(placements.body).toHaveLength(0);
    });
  });
});
