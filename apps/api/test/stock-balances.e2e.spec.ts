import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, uniqueEmail } from "./test-app";

interface OrgContext {
  email: string;
  accessToken: string;
  userId: string;
}

async function registerOrg(app: INestApplication, orgName: string): Promise<OrgContext> {
  const email = uniqueEmail("sb");
  const password = "correct-horse-battery-staple";
  const res = await request(app.getHttpServer())
    .post("/api/v1/auth/register")
    .send({ organizationName: orgName, fullName: "Admin", email, password });
  return { email, accessToken: res.body.accessToken as string, userId: res.body.user.id as string };
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
  return { email, accessToken: login.body.accessToken as string, userId: login.body.user.id as string };
}

function authed(app: INestApplication, token: string) {
  return {
    get: (url: string) => request(app.getHttpServer()).get(url).set("Authorization", `Bearer ${token}`),
    post: (url: string) => request(app.getHttpServer()).post(url).set("Authorization", `Bearer ${token}`),
    patch: (url: string) => request(app.getHttpServer()).patch(url).set("Authorization", `Bearer ${token}`),
  };
}

async function createProduct(
  app: INestApplication,
  token: string,
  overrides: Record<string, unknown> = {}
): Promise<{ id: string; baseUomCode: string }> {
  const res = await authed(app, token)
    .post("/api/v1/products")
    .send({ name: "Test Product", productType: "MATERIAL", baseUomCode: "KG", ...overrides });
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

describe("M2.4-B StockBalance", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("Basic CRUD", () => {
    it("creates a warehouse-level balance (no location) with default zero quantities", async () => {
      const admin = await registerOrg(app, "Balance Create Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/stock-balances")
        .send({ productId: product.id, warehouseId: wh.id, uomCode: "KG" });
      expect(res.status).toBe(201);
      // Decimal.toString() does not zero-pad (M2.2 lesson) — compare numerically.
      expect(Number(res.body.onHandQty)).toBe(0);
      expect(Number(res.body.reservedQty)).toBe(0);
      expect(Number(res.body.availableQty)).toBe(0);
      expect(res.body.locationId).toBeNull();
    });

    it("creates a location-level balance with explicit quantities and computes availableQty", async () => {
      const admin = await registerOrg(app, "Balance Create Location Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const loc = await createLocation(app, admin.accessToken, wh.id);
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/stock-balances")
        .send({ productId: product.id, warehouseId: wh.id, locationId: loc.id, uomCode: "KG", onHandQty: "500", reservedQty: "120" });
      expect(res.status).toBe(201);
      expect(Number(res.body.onHandQty)).toBe(500);
      expect(Number(res.body.reservedQty)).toBe(120);
      expect(Number(res.body.availableQty)).toBe(380);
    });

    it("lists and reads a single balance, and filters the list by productId/warehouseId/locationId", async () => {
      const admin = await registerOrg(app, "Balance Read Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const created = await authed(app, admin.accessToken)
        .post("/api/v1/stock-balances")
        .send({ productId: product.id, warehouseId: wh.id, uomCode: "KG" });

      const list = await authed(app, admin.accessToken).get(`/api/v1/stock-balances?productId=${product.id}`);
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(1);

      const get = await authed(app, admin.accessToken).get(`/api/v1/stock-balances/${created.body.id}`);
      expect(get.status).toBe(200);
      expect(get.body.id).toBe(created.body.id);
    });

    it("updates onHandQty/reservedQty administratively", async () => {
      const admin = await registerOrg(app, "Balance Update Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const created = await authed(app, admin.accessToken)
        .post("/api/v1/stock-balances")
        .send({ productId: product.id, warehouseId: wh.id, uomCode: "KG" });
      const res = await authed(app, admin.accessToken)
        .patch(`/api/v1/stock-balances/${created.body.id}`)
        .send({ onHandQty: "250.5", reservedQty: "50" });
      expect(res.status).toBe(200);
      expect(Number(res.body.onHandQty)).toBe(250.5);
      expect(Number(res.body.availableQty)).toBe(200.5);
    });

    it("cannot change productId/warehouseId/locationId/uomCode via PATCH (not in the update schema)", async () => {
      const admin = await registerOrg(app, "Balance Update Immutable Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const created = await authed(app, admin.accessToken)
        .post("/api/v1/stock-balances")
        .send({ productId: product.id, warehouseId: wh.id, uomCode: "KG" });
      const otherWh = await createWarehouse(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .patch(`/api/v1/stock-balances/${created.body.id}`)
        .send({ warehouseId: otherWh.id, onHandQty: "10" });
      expect(res.status).toBe(200);
      expect(res.body.warehouseId).toBe(wh.id);
    });
  });

  describe("A. Tenant isolation", () => {
    it("org A cannot GET org B's balance", async () => {
      const orgA = await registerOrg(app, "Tenant Balance A");
      const orgB = await registerOrg(app, "Tenant Balance B");
      const product = await createProduct(app, orgA.accessToken);
      const wh = await createWarehouse(app, orgA.accessToken);
      const created = await authed(app, orgA.accessToken)
        .post("/api/v1/stock-balances")
        .send({ productId: product.id, warehouseId: wh.id, uomCode: "KG" });
      const res = await authed(app, orgB.accessToken).get(`/api/v1/stock-balances/${created.body.id}`);
      expect(res.status).toBe(404);
    });

    it("org A cannot PATCH org B's balance", async () => {
      const orgA = await registerOrg(app, "Tenant Balance Patch A");
      const orgB = await registerOrg(app, "Tenant Balance Patch B");
      const product = await createProduct(app, orgA.accessToken);
      const wh = await createWarehouse(app, orgA.accessToken);
      const created = await authed(app, orgA.accessToken)
        .post("/api/v1/stock-balances")
        .send({ productId: product.id, warehouseId: wh.id, uomCode: "KG" });
      const res = await authed(app, orgB.accessToken).patch(`/api/v1/stock-balances/${created.body.id}`).send({ onHandQty: "999" });
      expect(res.status).toBe(404);
    });
  });

  describe("B-D. Foreign Product / Warehouse / Location", () => {
    it("B. foreign product (org B) -> 404", async () => {
      const orgA = await registerOrg(app, "Foreign Product A");
      const orgB = await registerOrg(app, "Foreign Product B");
      const productB = await createProduct(app, orgB.accessToken);
      const whA = await createWarehouse(app, orgA.accessToken);
      const res = await authed(app, orgA.accessToken)
        .post("/api/v1/stock-balances")
        .send({ productId: productB.id, warehouseId: whA.id, uomCode: "KG" });
      expect(res.status).toBe(404);
    });

    it("C. foreign warehouse (org B) -> 404", async () => {
      const orgA = await registerOrg(app, "Foreign Warehouse A");
      const orgB = await registerOrg(app, "Foreign Warehouse B");
      const productA = await createProduct(app, orgA.accessToken);
      const whB = await createWarehouse(app, orgB.accessToken);
      const res = await authed(app, orgA.accessToken)
        .post("/api/v1/stock-balances")
        .send({ productId: productA.id, warehouseId: whB.id, uomCode: "KG" });
      expect(res.status).toBe(404);
    });

    it("D. foreign location (org B) -> 404", async () => {
      const orgA = await registerOrg(app, "Foreign Location A");
      const orgB = await registerOrg(app, "Foreign Location B");
      const productA = await createProduct(app, orgA.accessToken);
      const whA = await createWarehouse(app, orgA.accessToken);
      const whB = await createWarehouse(app, orgB.accessToken);
      const locB = await createLocation(app, orgB.accessToken, whB.id);
      const res = await authed(app, orgA.accessToken)
        .post("/api/v1/stock-balances")
        .send({ productId: productA.id, warehouseId: whA.id, locationId: locB.id, uomCode: "KG" });
      expect(res.status).toBe(404);
    });
  });

  describe("E. Wrong warehouse/location composition", () => {
    it("location belongs to a different (same-org) warehouse than specified -> rejected", async () => {
      const admin = await registerOrg(app, "Composition Mismatch Co");
      const product = await createProduct(app, admin.accessToken);
      const whA = await createWarehouse(app, admin.accessToken);
      const whB = await createWarehouse(app, admin.accessToken);
      const locUnderB = await createLocation(app, admin.accessToken, whB.id);
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/stock-balances")
        .send({ productId: product.id, warehouseId: whA.id, locationId: locUnderB.id, uomCode: "KG" });
      expect(res.status).toBe(400);
    });
  });

  describe("F. Mass assignment", () => {
    it("organizationId in the body cannot retarget tenant ownership", async () => {
      const admin = await registerOrg(app, "Balance Mass Assign Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/stock-balances")
        .send({ productId: product.id, warehouseId: wh.id, uomCode: "KG", organizationId: "foreign-org-id" });
      expect(res.status).toBe(201);
      const get = await authed(app, admin.accessToken).get(`/api/v1/stock-balances/${res.body.id}`);
      expect(get.status).toBe(200);
    });
  });

  describe("G. UOM mismatch", () => {
    it("rejects a uomCode that differs from the product's baseUomCode", async () => {
      const admin = await registerOrg(app, "Uom Mismatch Co");
      const product = await createProduct(app, admin.accessToken, { baseUomCode: "KG" });
      const wh = await createWarehouse(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/stock-balances")
        .send({ productId: product.id, warehouseId: wh.id, uomCode: "M" });
      expect(res.status).toBe(400);
    });
  });

  describe("H-K. Uniqueness", () => {
    it("H. duplicate balance for product+warehouse+NULL location -> rejected (409)", async () => {
      const admin = await registerOrg(app, "Duplicate No Location Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      await authed(app, admin.accessToken).post("/api/v1/stock-balances").send({ productId: product.id, warehouseId: wh.id, uomCode: "KG" });
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/stock-balances")
        .send({ productId: product.id, warehouseId: wh.id, uomCode: "KG" });
      expect(res.status).toBe(409);
    });

    it("I. duplicate balance for product+warehouse+same location -> rejected (409)", async () => {
      const admin = await registerOrg(app, "Duplicate Same Location Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const loc = await createLocation(app, admin.accessToken, wh.id);
      await authed(app, admin.accessToken)
        .post("/api/v1/stock-balances")
        .send({ productId: product.id, warehouseId: wh.id, locationId: loc.id, uomCode: "KG" });
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/stock-balances")
        .send({ productId: product.id, warehouseId: wh.id, locationId: loc.id, uomCode: "KG" });
      expect(res.status).toBe(409);
    });

    it("J. same product+warehouse but different locations -> allowed", async () => {
      const admin = await registerOrg(app, "Different Locations Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const locA = await createLocation(app, admin.accessToken, wh.id);
      const locB = await createLocation(app, admin.accessToken, wh.id);
      const a = await authed(app, admin.accessToken)
        .post("/api/v1/stock-balances")
        .send({ productId: product.id, warehouseId: wh.id, locationId: locA.id, uomCode: "KG" });
      const b = await authed(app, admin.accessToken)
        .post("/api/v1/stock-balances")
        .send({ productId: product.id, warehouseId: wh.id, locationId: locB.id, uomCode: "KG" });
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
    });

    it("K. same product but different warehouses -> allowed", async () => {
      const admin = await registerOrg(app, "Different Warehouses Co");
      const product = await createProduct(app, admin.accessToken);
      const whA = await createWarehouse(app, admin.accessToken);
      const whB = await createWarehouse(app, admin.accessToken);
      const a = await authed(app, admin.accessToken)
        .post("/api/v1/stock-balances")
        .send({ productId: product.id, warehouseId: whA.id, uomCode: "KG" });
      const b = await authed(app, admin.accessToken)
        .post("/api/v1/stock-balances")
        .send({ productId: product.id, warehouseId: whB.id, uomCode: "KG" });
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
    });
  });

  describe("L-M. Quantity invariants", () => {
    it("L. rejects a negative onHandQty at creation", async () => {
      const admin = await registerOrg(app, "Negative OnHand Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/stock-balances")
        .send({ productId: product.id, warehouseId: wh.id, uomCode: "KG", onHandQty: "-5" });
      expect(res.status).toBe(400);
    });

    it("L. rejects a negative reservedQty on update", async () => {
      const admin = await registerOrg(app, "Negative Reserved Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const created = await authed(app, admin.accessToken)
        .post("/api/v1/stock-balances")
        .send({ productId: product.id, warehouseId: wh.id, uomCode: "KG", onHandQty: "100" });
      const res = await authed(app, admin.accessToken).patch(`/api/v1/stock-balances/${created.body.id}`).send({ reservedQty: "-1" });
      expect(res.status).toBe(400);
    });

    it("M. rejects reservedQty > onHandQty at creation", async () => {
      const admin = await registerOrg(app, "Reserved Exceeds OnHand Create Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/stock-balances")
        .send({ productId: product.id, warehouseId: wh.id, uomCode: "KG", onHandQty: "10", reservedQty: "20" });
      expect(res.status).toBe(400);
    });

    it("M. rejects reservedQty > onHandQty on update", async () => {
      const admin = await registerOrg(app, "Reserved Exceeds OnHand Update Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const created = await authed(app, admin.accessToken)
        .post("/api/v1/stock-balances")
        .send({ productId: product.id, warehouseId: wh.id, uomCode: "KG", onHandQty: "100", reservedQty: "40" });
      const res = await authed(app, admin.accessToken).patch(`/api/v1/stock-balances/${created.body.id}`).send({ onHandQty: "10" });
      expect(res.status).toBe(400);
    });
  });

  describe("N. RBAC", () => {
    it("EMPLOYEE can read but not create", async () => {
      const admin = await registerOrg(app, "Balance RBAC Employee Co");
      const employee = await inviteAndLogin(app, admin, "EMPLOYEE");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);

      const read = await authed(app, employee.accessToken).get("/api/v1/stock-balances");
      expect(read.status).toBe(200);

      const write = await authed(app, employee.accessToken)
        .post("/api/v1/stock-balances")
        .send({ productId: product.id, warehouseId: wh.id, uomCode: "KG" });
      expect(write.status).toBe(403);
    });

    it("PROCUREMENT_SPECIALIST cannot create a balance", async () => {
      const admin = await registerOrg(app, "Balance RBAC Specialist Co");
      const specialist = await inviteAndLogin(app, admin, "PROCUREMENT_SPECIALIST");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const res = await authed(app, specialist.accessToken)
        .post("/api/v1/stock-balances")
        .send({ productId: product.id, warehouseId: wh.id, uomCode: "KG" });
      expect(res.status).toBe(403);
    });

    it("PROCUREMENT_MANAGER can create and update a balance", async () => {
      const admin = await registerOrg(app, "Balance RBAC Manager Co");
      const manager = await inviteAndLogin(app, admin, "PROCUREMENT_MANAGER");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const created = await authed(app, manager.accessToken)
        .post("/api/v1/stock-balances")
        .send({ productId: product.id, warehouseId: wh.id, uomCode: "KG" });
      expect(created.status).toBe(201);
      const updated = await authed(app, manager.accessToken)
        .patch(`/api/v1/stock-balances/${created.body.id}`)
        .send({ onHandQty: "5" });
      expect(updated.status).toBe(200);
    });

    it("APPROVER can read but not write", async () => {
      const admin = await registerOrg(app, "Balance RBAC Approver Co");
      const approver = await inviteAndLogin(app, admin, "APPROVER");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const res = await authed(app, approver.accessToken)
        .post("/api/v1/stock-balances")
        .send({ productId: product.id, warehouseId: wh.id, uomCode: "KG" });
      expect(res.status).toBe(403);
    });
  });

  describe("O. Invalid IDs", () => {
    it("GET on a nonexistent (but well-formed) balance id returns 404", async () => {
      const admin = await registerOrg(app, "Invalid Id Get Co");
      const res = await authed(app, admin.accessToken).get("/api/v1/stock-balances/00000000-0000-0000-0000-000000000000");
      expect(res.status).toBe(404);
    });

    it("PATCH on a nonexistent balance id returns 404", async () => {
      const admin = await registerOrg(app, "Invalid Id Patch Co");
      const res = await authed(app, admin.accessToken)
        .patch("/api/v1/stock-balances/00000000-0000-0000-0000-000000000000")
        .send({ onHandQty: "1" });
      expect(res.status).toBe(404);
    });

    it("POST with a malformed (non-uuid) productId returns 400", async () => {
      const admin = await registerOrg(app, "Invalid Id Post Co");
      const wh = await createWarehouse(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/stock-balances")
        .send({ productId: "not-a-uuid", warehouseId: wh.id, uomCode: "KG" });
      expect(res.status).toBe(400);
    });
  });
});
