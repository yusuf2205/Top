import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, uniqueEmail } from "./test-app";

interface OrgContext {
  email: string;
  accessToken: string;
  userId: string;
}

async function registerOrg(app: INestApplication, orgName: string): Promise<OrgContext> {
  const email = uniqueEmail("prod");
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

describe("M2.1 Product Master", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("Product Category CRUD", () => {
    it("creates a root category", async () => {
      const admin = await registerOrg(app, "Category Root Co");
      const res = await authed(app, admin.accessToken).post("/api/v1/product-categories").send({ name: "Metals" });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe("Metals");
      expect(res.body.parentId).toBeNull();
      expect(res.body.active).toBe(true);
    });

    it("creates a child category via parentId", async () => {
      const admin = await registerOrg(app, "Category Tree Co");
      const parent = await authed(app, admin.accessToken).post("/api/v1/product-categories").send({ name: "Metals" });
      const child = await authed(app, admin.accessToken)
        .post("/api/v1/product-categories")
        .send({ name: "Copper", parentId: parent.body.id });
      expect(child.status).toBe(201);
      expect(child.body.parentId).toBe(parent.body.id);
    });

    it("rejects a self-referencing parentId (direct cycle)", async () => {
      const admin = await registerOrg(app, "Category Self Cycle Co");
      const cat = await authed(app, admin.accessToken).post("/api/v1/product-categories").send({ name: "Metals" });
      const res = await authed(app, admin.accessToken)
        .patch(`/api/v1/product-categories/${cat.body.id}`)
        .send({ parentId: cat.body.id });
      expect(res.status).toBe(400);
    });

    it("rejects a multi-level cycle (parent's parent becomes itself)", async () => {
      const admin = await registerOrg(app, "Category Multi Cycle Co");
      const a = await authed(app, admin.accessToken).post("/api/v1/product-categories").send({ name: "A" });
      const b = await authed(app, admin.accessToken)
        .post("/api/v1/product-categories")
        .send({ name: "B", parentId: a.body.id });
      const res = await authed(app, admin.accessToken)
        .patch(`/api/v1/product-categories/${a.body.id}`)
        .send({ parentId: b.body.id });
      expect(res.status).toBe(400);
    });
  });

  describe("Product CRUD", () => {
    it("creates a product with an explicit SKU", async () => {
      const admin = await registerOrg(app, "Product Basic Co");
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/products")
        .send({ sku: "CU-BUS-01", name: "Copper Busbar", productType: "MATERIAL", baseUomCode: "KG" });
      expect(res.status).toBe(201);
      expect(res.body.sku).toBe("CU-BUS-01");
      expect(res.body.active).toBe(true);
      expect(res.body.stockTracked).toBe(true);
      expect(res.body.trackingMode).toBe("QUANTITY");
    });

    it("auto-generates a SKU when none is supplied", async () => {
      const admin = await registerOrg(app, "Product AutoSku Co");
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/products")
        .send({ name: "Generic Widget", productType: "GOODS", baseUomCode: "PCS" });
      expect(res.status).toBe(201);
      expect(res.body.sku).toMatch(/^PRD-/);
    });

    it("rejects a duplicate SKU within the same organization", async () => {
      const admin = await registerOrg(app, "Product Dup Co");
      await authed(app, admin.accessToken)
        .post("/api/v1/products")
        .send({ sku: "DUP-01", name: "Item A", productType: "GOODS", baseUomCode: "PCS" });
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/products")
        .send({ sku: "DUP-01", name: "Item B", productType: "GOODS", baseUomCode: "PCS" });
      expect(res.status).toBe(409);
    });

    it("allows the same SKU across two different organizations", async () => {
      const orgA = await registerOrg(app, "Product SameSku Co A");
      const orgB = await registerOrg(app, "Product SameSku Co B");
      const resA = await authed(app, orgA.accessToken)
        .post("/api/v1/products")
        .send({ sku: "SHARED-01", name: "Item", productType: "GOODS", baseUomCode: "PCS" });
      const resB = await authed(app, orgB.accessToken)
        .post("/api/v1/products")
        .send({ sku: "SHARED-01", name: "Item", productType: "GOODS", baseUomCode: "PCS" });
      expect(resA.status).toBe(201);
      expect(resB.status).toBe(201);
    });

    it("rejects an invalid productType", async () => {
      const admin = await registerOrg(app, "Product InvalidType Co");
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/products")
        .send({ name: "Item", productType: "NOT_A_TYPE", baseUomCode: "PCS" });
      expect(res.status).toBe(400);
    });

    it("forces stockTracked=false for SERVICE products, even if the client tries to override it", async () => {
      const admin = await registerOrg(app, "Product Service Co");
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/products")
        .send({ name: "Installation Service", productType: "SERVICE", baseUomCode: "PCS", stockTracked: true });
      expect(res.status).toBe(201);
      expect(res.body.stockTracked).toBe(false);
    });

    it("lists products with pagination", async () => {
      const admin = await registerOrg(app, "Product Paginate Co");
      for (let i = 0; i < 3; i++) {
        await authed(app, admin.accessToken)
          .post("/api/v1/products")
          .send({ name: `Paginate Item ${i}`, productType: "GOODS", baseUomCode: "PCS" });
      }
      const page1 = await authed(app, admin.accessToken).get("/api/v1/products?page=1&pageSize=2");
      expect(page1.status).toBe(200);
      expect(page1.body.items.length).toBe(2);
      expect(page1.body.total).toBeGreaterThanOrEqual(3);
    });

    it("searches products by name and by SKU", async () => {
      const admin = await registerOrg(app, "Product Search Co");
      await authed(app, admin.accessToken)
        .post("/api/v1/products")
        .send({ sku: "FINDME-01", name: "Unique Widget Name", productType: "GOODS", baseUomCode: "PCS" });
      await authed(app, admin.accessToken)
        .post("/api/v1/products")
        .send({ sku: "OTHER-02", name: "Something Else", productType: "GOODS", baseUomCode: "PCS" });

      const byName = await authed(app, admin.accessToken).get(
        `/api/v1/products?search=${encodeURIComponent("Unique Widget")}`
      );
      expect(byName.body.items.every((p: { sku: string }) => p.sku === "FINDME-01")).toBe(true);
      expect(byName.body.items.length).toBe(1);

      const bySku = await authed(app, admin.accessToken).get("/api/v1/products?search=FINDME");
      expect(bySku.body.items.length).toBe(1);
      expect(bySku.body.items[0].sku).toBe("FINDME-01");
    });

    it("filters by productType and active", async () => {
      const admin = await registerOrg(app, "Product Filter Co");
      await authed(app, admin.accessToken)
        .post("/api/v1/products")
        .send({ name: "A Service", productType: "SERVICE", baseUomCode: "PCS" });
      const good = await authed(app, admin.accessToken)
        .post("/api/v1/products")
        .send({ name: "A Good", productType: "GOODS", baseUomCode: "PCS" });

      const res = await authed(app, admin.accessToken).get("/api/v1/products?productType=SERVICE&active=true");
      expect(res.body.items.every((p: { productType: string }) => p.productType === "SERVICE")).toBe(true);

      // Regression test: z.coerce.boolean() would treat the string "false" as
      // truthy (any non-empty string is truthy in JS) — active=false must
      // actually mean false, not silently behave like active=true.
      await authed(app, admin.accessToken).post(`/api/v1/products/${good.body.id}/archive`).send();
      const inactiveOnly = await authed(app, admin.accessToken).get("/api/v1/products?active=false");
      expect(inactiveOnly.body.items.some((p: { id: string }) => p.id === good.body.id)).toBe(true);
      expect(inactiveOnly.body.items.every((p: { active: boolean }) => p.active === false)).toBe(true);
    });

    it("returns 404 for a nonexistent product id", async () => {
      const admin = await registerOrg(app, "Product NotFound Co");
      const res = await authed(app, admin.accessToken).get("/api/v1/products/00000000-0000-0000-0000-000000000000");
      expect(res.status).toBe(404);
    });

    it("updates a product", async () => {
      const admin = await registerOrg(app, "Product Update Co");
      const created = await authed(app, admin.accessToken)
        .post("/api/v1/products")
        .send({ name: "Original Name", productType: "GOODS", baseUomCode: "PCS" });
      const updated = await authed(app, admin.accessToken)
        .patch(`/api/v1/products/${created.body.id}`)
        .send({ name: "Updated Name" });
      expect(updated.status).toBe(200);
      expect(updated.body.name).toBe("Updated Name");
    });

    it("archives a product", async () => {
      const admin = await registerOrg(app, "Product Archive Co");
      const created = await authed(app, admin.accessToken)
        .post("/api/v1/products")
        .send({ name: "To Archive", productType: "GOODS", baseUomCode: "PCS" });
      const archived = await authed(app, admin.accessToken).post(`/api/v1/products/${created.body.id}/archive`).send();
      expect(archived.status).toBe(200);
      expect(archived.body.active).toBe(false);
    });
  });

  describe("RBAC", () => {
    it("EMPLOYEE can list/read but not create products", async () => {
      const admin = await registerOrg(app, "RBAC Employee Co");
      const employee = await inviteAndLogin(app, admin, "EMPLOYEE");
      const list = await authed(app, employee.accessToken).get("/api/v1/products");
      expect(list.status).toBe(200);
      const create = await authed(app, employee.accessToken)
        .post("/api/v1/products")
        .send({ name: "Item", productType: "GOODS", baseUomCode: "PCS" });
      expect(create.status).toBe(403);
    });

    it("PROCUREMENT_SPECIALIST can create/update but not archive", async () => {
      const admin = await registerOrg(app, "RBAC Specialist Co");
      const specialist = await inviteAndLogin(app, admin, "PROCUREMENT_SPECIALIST");
      const created = await authed(app, specialist.accessToken)
        .post("/api/v1/products")
        .send({ name: "Item", productType: "GOODS", baseUomCode: "PCS" });
      expect(created.status).toBe(201);
      const updated = await authed(app, specialist.accessToken)
        .patch(`/api/v1/products/${created.body.id}`)
        .send({ name: "Renamed" });
      expect(updated.status).toBe(200);
      const archived = await authed(app, specialist.accessToken).post(`/api/v1/products/${created.body.id}/archive`).send();
      expect(archived.status).toBe(403);
    });

    it("PROCUREMENT_MANAGER can archive", async () => {
      const admin = await registerOrg(app, "RBAC Manager Co");
      const manager = await inviteAndLogin(app, admin, "PROCUREMENT_MANAGER");
      const created = await authed(app, manager.accessToken)
        .post("/api/v1/products")
        .send({ name: "Item", productType: "GOODS", baseUomCode: "PCS" });
      const archived = await authed(app, manager.accessToken).post(`/api/v1/products/${created.body.id}/archive`).send();
      expect(archived.status).toBe(200);
    });
  });

  describe("Tenant isolation", () => {
    it("Org A cannot read Org B's product by id (404, not 403)", async () => {
      const orgA = await registerOrg(app, "Tenant Iso Co A1");
      const orgB = await registerOrg(app, "Tenant Iso Co B1");
      const productB = await authed(app, orgB.accessToken)
        .post("/api/v1/products")
        .send({ name: "Org B Product", productType: "GOODS", baseUomCode: "PCS" });

      const res = await authed(app, orgA.accessToken).get(`/api/v1/products/${productB.body.id}`);
      expect(res.status).toBe(404);
    });

    it("Org A cannot update Org B's product by id (404)", async () => {
      const orgA = await registerOrg(app, "Tenant Iso Co A2");
      const orgB = await registerOrg(app, "Tenant Iso Co B2");
      const productB = await authed(app, orgB.accessToken)
        .post("/api/v1/products")
        .send({ name: "Org B Product", productType: "GOODS", baseUomCode: "PCS" });

      const res = await authed(app, orgA.accessToken)
        .patch(`/api/v1/products/${productB.body.id}`)
        .send({ name: "Hijacked" });
      expect(res.status).toBe(404);
    });

    it("Org A's product list never includes Org B's products", async () => {
      const orgA = await registerOrg(app, "Tenant Iso Co A3");
      const orgB = await registerOrg(app, "Tenant Iso Co B3");
      const productB = await authed(app, orgB.accessToken)
        .post("/api/v1/products")
        .send({ name: "Org B Only Product", productType: "GOODS", baseUomCode: "PCS" });

      const listA = await authed(app, orgA.accessToken).get("/api/v1/products?pageSize=100");
      expect(listA.body.items.some((p: { id: string }) => p.id === productB.body.id)).toBe(false);
    });

    it("Org A cannot create a product with a categoryId belonging to Org B", async () => {
      const orgA = await registerOrg(app, "Tenant Iso Co A4");
      const orgB = await registerOrg(app, "Tenant Iso Co B4");
      const categoryB = await authed(app, orgB.accessToken).post("/api/v1/product-categories").send({ name: "Org B Category" });

      const res = await authed(app, orgA.accessToken)
        .post("/api/v1/products")
        .send({ name: "Item", productType: "GOODS", baseUomCode: "PCS", categoryId: categoryB.body.id });
      expect(res.status).toBe(400);
    });

    it("Org A cannot repoint a product's categoryId to Org B's category via update", async () => {
      const orgA = await registerOrg(app, "Tenant Iso Co A5");
      const orgB = await registerOrg(app, "Tenant Iso Co B5");
      const productA = await authed(app, orgA.accessToken)
        .post("/api/v1/products")
        .send({ name: "Item", productType: "GOODS", baseUomCode: "PCS" });
      const categoryB = await authed(app, orgB.accessToken).post("/api/v1/product-categories").send({ name: "Org B Category" });

      const res = await authed(app, orgA.accessToken)
        .patch(`/api/v1/products/${productA.body.id}`)
        .send({ categoryId: categoryB.body.id });
      expect(res.status).toBe(400);
    });
  });

  describe("Mass assignment", () => {
    it("a client-supplied organizationId in the request body is ignored — product still lands in the caller's own org", async () => {
      const orgA = await registerOrg(app, "Mass Assign Co A");
      const orgB = await registerOrg(app, "Mass Assign Co B");

      const created = await authed(app, orgA.accessToken)
        .post("/api/v1/products")
        .send({
          name: "Injected Org Product",
          productType: "GOODS",
          baseUomCode: "PCS",
          organizationId: "some-other-org-id",
          createdById: "attacker-user-id",
        });
      expect(created.status).toBe(201);

      const seenByOrgB = await authed(app, orgB.accessToken).get(`/api/v1/products/${created.body.id}`);
      expect(seenByOrgB.status).toBe(404);

      const seenByOrgA = await authed(app, orgA.accessToken).get(`/api/v1/products/${created.body.id}`);
      expect(seenByOrgA.status).toBe(200);
    });
  });
});
