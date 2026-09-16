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
  const email = uniqueEmail("lot");
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

async function createStockLot(
  app: INestApplication,
  token: string,
  productId: string,
  overrides: Record<string, unknown> = {}
): Promise<{ id: string }> {
  const res = await authed(app, token).post("/api/v1/stock-lots").send({ productId, ...overrides });
  return { id: res.body.id as string };
}

describe("M2.4-C StockLot + StockLotPlacement", () => {
  let app: INestApplication;
  // No REST API for Supplier exists yet — this is the same "seed script"
  // exception client.ts's own doc comment carves out for SYSTEM_PRISMA,
  // used here purely for test setup, never in application code.
  let systemDb: ReturnType<typeof createSystemPrismaClient>;

  beforeAll(async () => {
    app = await createTestApp();
    systemDb = createSystemPrismaClient();
  });

  afterAll(async () => {
    await app.close();
    await systemDb.$disconnect();
  });

  async function createSupplierDirect(organizationId: string): Promise<{ id: string }> {
    // M3.2: supplierCode is now required — this helper bypasses
    // SuppliersService entirely (no REST API existed for Supplier when this
    // file was written), so it supplies a unique code by hand rather than
    // pulling in EntitySequenceService for a StockLot-focused test file.
    const supplierCode = `SUP-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const supplier = await systemDb.supplier.create({ data: { organizationId, companyName: "Test Supplier", supplierCode } });
    return { id: supplier.id };
  }

  describe("StockLot — basic CRUD", () => {
    it("creates a lot with no supplier and no lot number", async () => {
      const admin = await registerOrg(app, "Lot Create Co");
      const product = await createProduct(app, admin.accessToken);
      const res = await authed(app, admin.accessToken).post("/api/v1/stock-lots").send({ productId: product.id });
      expect(res.status).toBe(201);
      expect(res.body.productId).toBe(product.id);
      expect(res.body.supplierId).toBeNull();
      expect(res.body.lotNumber).toBeNull();
    });

    it("creates a lot with a supplier and lot number", async () => {
      const admin = await registerOrg(app, "Lot Create Full Co");
      const product = await createProduct(app, admin.accessToken);
      const supplier = await createSupplierDirect(admin.organizationId);
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/stock-lots")
        .send({ productId: product.id, supplierId: supplier.id, lotNumber: "SUP-2026-001" });
      expect(res.status).toBe(201);
      expect(res.body.supplierId).toBe(supplier.id);
      expect(res.body.lotNumber).toBe("SUP-2026-001");
    });

    it("lists and reads a single lot, and filters the list", async () => {
      const admin = await registerOrg(app, "Lot Read Co");
      const product = await createProduct(app, admin.accessToken);
      const lot = await createStockLot(app, admin.accessToken, product.id, { lotNumber: "L001" });

      const list = await authed(app, admin.accessToken).get(`/api/v1/stock-lots?lotNumber=L001`);
      expect(list.status).toBe(200);
      expect(list.body.some((l: { id: string }) => l.id === lot.id)).toBe(true);

      const get = await authed(app, admin.accessToken).get(`/api/v1/stock-lots/${lot.id}`);
      expect(get.status).toBe(200);
      expect(get.body.id).toBe(lot.id);
    });

    it("updates a lot's supplier and lot number", async () => {
      const admin = await registerOrg(app, "Lot Update Co");
      const product = await createProduct(app, admin.accessToken);
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const res = await authed(app, admin.accessToken).patch(`/api/v1/stock-lots/${lot.id}`).send({ lotNumber: "L002" });
      expect(res.status).toBe(200);
      expect(res.body.lotNumber).toBe("L002");
    });
  });

  describe("1-2. StockLot tenant isolation", () => {
    it("1. cross-tenant GET on a lot -> 404", async () => {
      const orgA = await registerOrg(app, "Lot Tenant A");
      const orgB = await registerOrg(app, "Lot Tenant B");
      const product = await createProduct(app, orgA.accessToken);
      const lot = await createStockLot(app, orgA.accessToken, product.id);
      const res = await authed(app, orgB.accessToken).get(`/api/v1/stock-lots/${lot.id}`);
      expect(res.status).toBe(404);
    });

    it("2. cross-tenant PATCH on a lot -> 404", async () => {
      const orgA = await registerOrg(app, "Lot Tenant Patch A");
      const orgB = await registerOrg(app, "Lot Tenant Patch B");
      const product = await createProduct(app, orgA.accessToken);
      const lot = await createStockLot(app, orgA.accessToken, product.id);
      const res = await authed(app, orgB.accessToken).patch(`/api/v1/stock-lots/${lot.id}`).send({ lotNumber: "hijack" });
      expect(res.status).toBe(404);
    });
  });

  describe("3-4. Foreign Product / Supplier", () => {
    it("3. foreign product (org B) -> 404", async () => {
      const orgA = await registerOrg(app, "Lot Foreign Product A");
      const orgB = await registerOrg(app, "Lot Foreign Product B");
      const productB = await createProduct(app, orgB.accessToken);
      const res = await authed(app, orgA.accessToken).post("/api/v1/stock-lots").send({ productId: productB.id });
      expect(res.status).toBe(404);
    });

    it("4. foreign supplier (org B) -> 404", async () => {
      const orgA = await registerOrg(app, "Lot Foreign Supplier A");
      const orgB = await registerOrg(app, "Lot Foreign Supplier B");
      const productA = await createProduct(app, orgA.accessToken);
      const supplierB = await createSupplierDirect(orgB.organizationId);
      const res = await authed(app, orgA.accessToken)
        .post("/api/v1/stock-lots")
        .send({ productId: productA.id, supplierId: supplierB.id });
      expect(res.status).toBe(404);
    });
  });

  describe("5. Mass assignment", () => {
    it("organizationId in the body cannot retarget tenant ownership", async () => {
      const admin = await registerOrg(app, "Lot Mass Assign Co");
      const product = await createProduct(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/stock-lots")
        .send({ productId: product.id, organizationId: "foreign-org-id" });
      expect(res.status).toBe(201);
      const get = await authed(app, admin.accessToken).get(`/api/v1/stock-lots/${res.body.id}`);
      expect(get.status).toBe(200);
    });
  });

  describe("6-9. Duplicate lot numbers are valid", () => {
    it("6-7. duplicate lotNumber (including duplicate NULL) is allowed", async () => {
      const admin = await registerOrg(app, "Lot Duplicate Co");
      const product = await createProduct(app, admin.accessToken);
      const a = await authed(app, admin.accessToken).post("/api/v1/stock-lots").send({ productId: product.id, lotNumber: "DUP" });
      const b = await authed(app, admin.accessToken).post("/api/v1/stock-lots").send({ productId: product.id, lotNumber: "DUP" });
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      const c = await authed(app, admin.accessToken).post("/api/v1/stock-lots").send({ productId: product.id });
      const d = await authed(app, admin.accessToken).post("/api/v1/stock-lots").send({ productId: product.id });
      expect(c.status).toBe(201);
      expect(d.status).toBe(201);
    });

    it("8. same product + same lotNumber, twice, is allowed", async () => {
      const admin = await registerOrg(app, "Lot Same Product Number Co");
      const product = await createProduct(app, admin.accessToken);
      const a = await authed(app, admin.accessToken).post("/api/v1/stock-lots").send({ productId: product.id, lotNumber: "L001" });
      const b = await authed(app, admin.accessToken).post("/api/v1/stock-lots").send({ productId: product.id, lotNumber: "L001" });
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(a.body.id).not.toBe(b.body.id);
    });

    it("9. same supplier + same lotNumber, twice, is allowed", async () => {
      const admin = await registerOrg(app, "Lot Same Supplier Number Co");
      const product = await createProduct(app, admin.accessToken);
      const supplier = await createSupplierDirect(admin.organizationId);
      const a = await authed(app, admin.accessToken)
        .post("/api/v1/stock-lots")
        .send({ productId: product.id, supplierId: supplier.id, lotNumber: "L001" });
      const b = await authed(app, admin.accessToken)
        .post("/api/v1/stock-lots")
        .send({ productId: product.id, supplierId: supplier.id, lotNumber: "L001" });
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
    });
  });

  describe("StockLotPlacement — basic CRUD", () => {
    it("creates a warehouse-level placement (no location)", async () => {
      const admin = await registerOrg(app, "Placement Create Co");
      const product = await createProduct(app, admin.accessToken);
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const wh = await createWarehouse(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .post(`/api/v1/stock-lots/${lot.id}/placements`)
        .send({ warehouseId: wh.id, uomCode: "KG", quantity: "500" });
      expect(res.status).toBe(201);
      expect(res.body.stockLotId).toBe(lot.id);
      expect(res.body.productId).toBe(product.id);
      expect(Number(res.body.quantity)).toBe(500);
      expect(res.body.locationId).toBeNull();
    });

    it("lists, reads, and updates a placement's quantity", async () => {
      const admin = await registerOrg(app, "Placement Read Update Co");
      const product = await createProduct(app, admin.accessToken);
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const wh = await createWarehouse(app, admin.accessToken);
      const created = await authed(app, admin.accessToken)
        .post(`/api/v1/stock-lots/${lot.id}/placements`)
        .send({ warehouseId: wh.id, uomCode: "KG", quantity: "100" });

      const list = await authed(app, admin.accessToken).get(`/api/v1/stock-lots/${lot.id}/placements`);
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(1);

      const get = await authed(app, admin.accessToken).get(`/api/v1/stock-lots/${lot.id}/placements/${created.body.id}`);
      expect(get.status).toBe(200);

      const updated = await authed(app, admin.accessToken)
        .patch(`/api/v1/stock-lots/${lot.id}/placements/${created.body.id}`)
        .send({ quantity: "250" });
      expect(updated.status).toBe(200);
      expect(Number(updated.body.quantity)).toBe(250);
    });
  });

  describe("10-12. StockLotPlacement tenant isolation", () => {
    it("10. cross-tenant StockLot (:stockLotId from org B) -> 404", async () => {
      const orgA = await registerOrg(app, "Placement Tenant Lot A");
      const orgB = await registerOrg(app, "Placement Tenant Lot B");
      const product = await createProduct(app, orgB.accessToken);
      const lotB = await createStockLot(app, orgB.accessToken, product.id);
      const whA = await createWarehouse(app, orgA.accessToken);
      const res = await authed(app, orgA.accessToken)
        .post(`/api/v1/stock-lots/${lotB.id}/placements`)
        .send({ warehouseId: whA.id, uomCode: "KG" });
      expect(res.status).toBe(404);
    });

    it("11. cross-tenant Warehouse (org B) -> 404", async () => {
      const orgA = await registerOrg(app, "Placement Tenant Wh A");
      const orgB = await registerOrg(app, "Placement Tenant Wh B");
      const product = await createProduct(app, orgA.accessToken);
      const lot = await createStockLot(app, orgA.accessToken, product.id);
      const whB = await createWarehouse(app, orgB.accessToken);
      const res = await authed(app, orgA.accessToken)
        .post(`/api/v1/stock-lots/${lot.id}/placements`)
        .send({ warehouseId: whB.id, uomCode: "KG" });
      expect(res.status).toBe(404);
    });

    it("12. cross-tenant Location (org B) -> 404", async () => {
      const orgA = await registerOrg(app, "Placement Tenant Loc A");
      const orgB = await registerOrg(app, "Placement Tenant Loc B");
      const product = await createProduct(app, orgA.accessToken);
      const lot = await createStockLot(app, orgA.accessToken, product.id);
      const whA = await createWarehouse(app, orgA.accessToken);
      const whB = await createWarehouse(app, orgB.accessToken);
      const locB = await createLocation(app, orgB.accessToken, whB.id);
      const res = await authed(app, orgA.accessToken)
        .post(`/api/v1/stock-lots/${lot.id}/placements`)
        .send({ warehouseId: whA.id, locationId: locB.id, uomCode: "KG" });
      expect(res.status).toBe(404);
    });
  });

  describe("13-14. productId is server-derived, never client-trusted", () => {
    it("13-14. a productId in the request body cannot override the lot's own product", async () => {
      const admin = await registerOrg(app, "Placement Product Derive Co");
      const productA = await createProduct(app, admin.accessToken, { name: "A" });
      const productB = await createProduct(app, admin.accessToken, { name: "B" });
      const lotA = await createStockLot(app, admin.accessToken, productA.id);
      const wh = await createWarehouse(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .post(`/api/v1/stock-lots/${lotA.id}/placements`)
        .send({ warehouseId: wh.id, uomCode: "KG", productId: productB.id });
      expect(res.status).toBe(201);
      expect(res.body.productId).toBe(productA.id);
    });
  });

  describe("15-16. Composition and UOM validation", () => {
    it("15. location belongs to a different (same-org) warehouse than specified -> 400", async () => {
      const admin = await registerOrg(app, "Placement Composition Co");
      const product = await createProduct(app, admin.accessToken);
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const whA = await createWarehouse(app, admin.accessToken);
      const whB = await createWarehouse(app, admin.accessToken);
      const locUnderB = await createLocation(app, admin.accessToken, whB.id);
      const res = await authed(app, admin.accessToken)
        .post(`/api/v1/stock-lots/${lot.id}/placements`)
        .send({ warehouseId: whA.id, locationId: locUnderB.id, uomCode: "KG" });
      expect(res.status).toBe(400);
    });

    it("16. uomCode mismatch with the product's baseUomCode -> 400", async () => {
      const admin = await registerOrg(app, "Placement Uom Mismatch Co");
      const product = await createProduct(app, admin.accessToken, { baseUomCode: "KG" });
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const wh = await createWarehouse(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .post(`/api/v1/stock-lots/${lot.id}/placements`)
        .send({ warehouseId: wh.id, uomCode: "M" });
      expect(res.status).toBe(400);
    });
  });

  describe("17. Negative quantity", () => {
    it("rejects a negative placement quantity at creation", async () => {
      const admin = await registerOrg(app, "Placement Negative Qty Co");
      const product = await createProduct(app, admin.accessToken);
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const wh = await createWarehouse(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .post(`/api/v1/stock-lots/${lot.id}/placements`)
        .send({ warehouseId: wh.id, uomCode: "KG", quantity: "-5" });
      expect(res.status).toBe(400);
    });

    it("rejects a negative placement quantity on update", async () => {
      const admin = await registerOrg(app, "Placement Negative Qty Update Co");
      const product = await createProduct(app, admin.accessToken);
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const wh = await createWarehouse(app, admin.accessToken);
      const created = await authed(app, admin.accessToken)
        .post(`/api/v1/stock-lots/${lot.id}/placements`)
        .send({ warehouseId: wh.id, uomCode: "KG", quantity: "10" });
      const res = await authed(app, admin.accessToken)
        .patch(`/api/v1/stock-lots/${lot.id}/placements/${created.body.id}`)
        .send({ quantity: "-1" });
      expect(res.status).toBe(400);
    });
  });

  describe("18-21. Placement uniqueness", () => {
    it("18. duplicate placement for lot+warehouse+NULL location -> 409", async () => {
      const admin = await registerOrg(app, "Placement Duplicate No Location Co");
      const product = await createProduct(app, admin.accessToken);
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const wh = await createWarehouse(app, admin.accessToken);
      await authed(app, admin.accessToken).post(`/api/v1/stock-lots/${lot.id}/placements`).send({ warehouseId: wh.id, uomCode: "KG" });
      const res = await authed(app, admin.accessToken)
        .post(`/api/v1/stock-lots/${lot.id}/placements`)
        .send({ warehouseId: wh.id, uomCode: "KG" });
      expect(res.status).toBe(409);
    });

    it("19. duplicate placement for lot+warehouse+same location -> 409", async () => {
      const admin = await registerOrg(app, "Placement Duplicate Same Location Co");
      const product = await createProduct(app, admin.accessToken);
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const wh = await createWarehouse(app, admin.accessToken);
      const loc = await createLocation(app, admin.accessToken, wh.id);
      await authed(app, admin.accessToken)
        .post(`/api/v1/stock-lots/${lot.id}/placements`)
        .send({ warehouseId: wh.id, locationId: loc.id, uomCode: "KG" });
      const res = await authed(app, admin.accessToken)
        .post(`/api/v1/stock-lots/${lot.id}/placements`)
        .send({ warehouseId: wh.id, locationId: loc.id, uomCode: "KG" });
      expect(res.status).toBe(409);
    });

    it("20. same lot, different locations -> allowed", async () => {
      const admin = await registerOrg(app, "Placement Different Locations Co");
      const product = await createProduct(app, admin.accessToken);
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const wh = await createWarehouse(app, admin.accessToken);
      const locA = await createLocation(app, admin.accessToken, wh.id);
      const locB = await createLocation(app, admin.accessToken, wh.id);
      const a = await authed(app, admin.accessToken)
        .post(`/api/v1/stock-lots/${lot.id}/placements`)
        .send({ warehouseId: wh.id, locationId: locA.id, uomCode: "KG", quantity: "600" });
      const b = await authed(app, admin.accessToken)
        .post(`/api/v1/stock-lots/${lot.id}/placements`)
        .send({ warehouseId: wh.id, locationId: locB.id, uomCode: "KG", quantity: "400" });
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
    });

    it("21. same lot, different warehouses -> allowed", async () => {
      const admin = await registerOrg(app, "Placement Different Warehouses Co");
      const product = await createProduct(app, admin.accessToken);
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const whA = await createWarehouse(app, admin.accessToken);
      const whB = await createWarehouse(app, admin.accessToken);
      const a = await authed(app, admin.accessToken)
        .post(`/api/v1/stock-lots/${lot.id}/placements`)
        .send({ warehouseId: whA.id, uomCode: "KG" });
      const b = await authed(app, admin.accessToken)
        .post(`/api/v1/stock-lots/${lot.id}/placements`)
        .send({ warehouseId: whB.id, uomCode: "KG" });
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
    });
  });

  describe("22. Mass assignment on placement", () => {
    it("organizationId in the body cannot retarget tenant ownership", async () => {
      const admin = await registerOrg(app, "Placement Mass Assign Co");
      const product = await createProduct(app, admin.accessToken);
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const wh = await createWarehouse(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .post(`/api/v1/stock-lots/${lot.id}/placements`)
        .send({ warehouseId: wh.id, uomCode: "KG", organizationId: "foreign-org-id" });
      expect(res.status).toBe(201);
      const get = await authed(app, admin.accessToken).get(`/api/v1/stock-lots/${lot.id}/placements/${res.body.id}`);
      expect(get.status).toBe(200);
    });
  });

  describe("23-26. RBAC", () => {
    it("23. EMPLOYEE can read StockLot and StockLotPlacement", async () => {
      const admin = await registerOrg(app, "Lot RBAC Read Co");
      const employee = await inviteAndLogin(app, admin, "EMPLOYEE");
      const product = await createProduct(app, admin.accessToken);
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const lots = await authed(app, employee.accessToken).get("/api/v1/stock-lots");
      expect(lots.status).toBe(200);
      const placements = await authed(app, employee.accessToken).get(`/api/v1/stock-lots/${lot.id}/placements`);
      expect(placements.status).toBe(200);
    });

    it("24. ADMIN can create a lot and a placement", async () => {
      const admin = await registerOrg(app, "Lot RBAC Admin Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const lot = await authed(app, admin.accessToken).post("/api/v1/stock-lots").send({ productId: product.id });
      expect(lot.status).toBe(201);
      const placement = await authed(app, admin.accessToken)
        .post(`/api/v1/stock-lots/${lot.body.id}/placements`)
        .send({ warehouseId: wh.id, uomCode: "KG" });
      expect(placement.status).toBe(201);
    });

    it("25. PROCUREMENT_MANAGER can create a lot and a placement", async () => {
      const admin = await registerOrg(app, "Lot RBAC Manager Co");
      const manager = await inviteAndLogin(app, admin, "PROCUREMENT_MANAGER");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const lot = await authed(app, manager.accessToken).post("/api/v1/stock-lots").send({ productId: product.id });
      expect(lot.status).toBe(201);
      const placement = await authed(app, manager.accessToken)
        .post(`/api/v1/stock-lots/${lot.body.id}/placements`)
        .send({ warehouseId: wh.id, uomCode: "KG" });
      expect(placement.status).toBe(201);
    });

    it("26. PROCUREMENT_SPECIALIST and APPROVER get 403 on write", async () => {
      const admin = await registerOrg(app, "Lot RBAC Other Co");
      const specialist = await inviteAndLogin(app, admin, "PROCUREMENT_SPECIALIST");
      const approver = await inviteAndLogin(app, admin, "APPROVER");
      const product = await createProduct(app, admin.accessToken);

      const specialistRes = await authed(app, specialist.accessToken).post("/api/v1/stock-lots").send({ productId: product.id });
      expect(specialistRes.status).toBe(403);

      const approverRes = await authed(app, approver.accessToken).post("/api/v1/stock-lots").send({ productId: product.id });
      expect(approverRes.status).toBe(403);
    });
  });

  describe("21 (approval §21). Consistency: placement/lot CRUD never touches StockBalance", () => {
    it("POST a placement does not create or change StockBalance", async () => {
      const admin = await registerOrg(app, "Consistency Post Co");
      const product = await createProduct(app, admin.accessToken);
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const wh = await createWarehouse(app, admin.accessToken);

      await authed(app, admin.accessToken)
        .post(`/api/v1/stock-lots/${lot.id}/placements`)
        .send({ warehouseId: wh.id, uomCode: "KG", quantity: "500" });

      const balances = await authed(app, admin.accessToken).get(`/api/v1/stock-balances?productId=${product.id}&warehouseId=${wh.id}`);
      expect(balances.status).toBe(200);
      expect(balances.body).toHaveLength(0);
    });

    it("PATCH a placement's quantity does not change an existing StockBalance", async () => {
      const admin = await registerOrg(app, "Consistency Patch Co");
      const product = await createProduct(app, admin.accessToken);
      const lot = await createStockLot(app, admin.accessToken, product.id);
      const wh = await createWarehouse(app, admin.accessToken);

      const balance = await authed(app, admin.accessToken)
        .post("/api/v1/stock-balances")
        .send({ productId: product.id, warehouseId: wh.id, uomCode: "KG", onHandQty: "100" });

      const placement = await authed(app, admin.accessToken)
        .post(`/api/v1/stock-lots/${lot.id}/placements`)
        .send({ warehouseId: wh.id, uomCode: "KG", quantity: "50" });
      await authed(app, admin.accessToken)
        .patch(`/api/v1/stock-lots/${lot.id}/placements/${placement.body.id}`)
        .send({ quantity: "999" });

      const balanceAfter = await authed(app, admin.accessToken).get(`/api/v1/stock-balances/${balance.body.id}`);
      expect(Number(balanceAfter.body.onHandQty)).toBe(100);
    });

    it("POST a StockLot does not create a StockBalance row", async () => {
      const admin = await registerOrg(app, "Consistency Lot Create Co");
      const product = await createProduct(app, admin.accessToken);
      await createStockLot(app, admin.accessToken, product.id);

      const balances = await authed(app, admin.accessToken).get(`/api/v1/stock-balances?productId=${product.id}`);
      expect(balances.status).toBe(200);
      expect(balances.body).toHaveLength(0);
    });
  });
});
