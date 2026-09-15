import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, uniqueEmail } from "./test-app";

interface OrgContext {
  email: string;
  accessToken: string;
  userId: string;
}

async function registerOrg(app: INestApplication, orgName: string): Promise<OrgContext> {
  const email = uniqueEmail("uom");
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
    delete: (url: string) => request(app.getHttpServer()).delete(url).set("Authorization", `Bearer ${token}`),
  };
}

async function createProduct(
  app: INestApplication,
  token: string,
  overrides: Record<string, unknown> = {}
): Promise<{ id: string }> {
  const res = await authed(app, token)
    .post("/api/v1/products")
    .send({ name: "Test Product", productType: "MATERIAL", baseUomCode: "KG", ...overrides });
  return { id: res.body.id as string };
}

describe("M2.2 UOM Conversions", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("Same-dimension conversion (pure math, no product-specific row needed)", () => {
    it("1. kg -> g", async () => {
      const admin = await registerOrg(app, "SameDim Co 1");
      const product = await createProduct(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .post(`/api/v1/products/${product.id}/convert`)
        .send({ quantity: "5", fromUomCode: "KG", toUomCode: "G" });
      expect(res.status).toBe(200);
      expect(res.body.quantity).toBe("5000.000");
    });

    it("2. g -> kg", async () => {
      const admin = await registerOrg(app, "SameDim Co 2");
      const product = await createProduct(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .post(`/api/v1/products/${product.id}/convert`)
        .send({ quantity: "2500", fromUomCode: "G", toUomCode: "KG" });
      expect(res.body.quantity).toBe("2.500");
    });

    it("3. m -> cm", async () => {
      const admin = await registerOrg(app, "SameDim Co 3");
      const product = await createProduct(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .post(`/api/v1/products/${product.id}/convert`)
        .send({ quantity: "2.5", fromUomCode: "M", toUomCode: "CM" });
      expect(res.body.quantity).toBe("250.000");
    });

    it("4. cm -> mm", async () => {
      const admin = await registerOrg(app, "SameDim Co 4");
      const product = await createProduct(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .post(`/api/v1/products/${product.id}/convert`)
        .send({ quantity: "25", fromUomCode: "CM", toUomCode: "MM" });
      expect(res.body.quantity).toBe("250.000");
    });

    it("same UOM is the identity conversion", async () => {
      const admin = await registerOrg(app, "SameDim Identity Co");
      const product = await createProduct(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .post(`/api/v1/products/${product.id}/convert`)
        .send({ quantity: "7.5", fromUomCode: "KG", toUomCode: "KG" });
      expect(res.body.quantity).toBe("7.500");
    });
  });

  describe("Cross-dimension conversion — product-specific only", () => {
    it("5. invalid kg -> m without a configured conversion is rejected, not guessed", async () => {
      const admin = await registerOrg(app, "CrossDim NoConv Co");
      const product = await createProduct(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .post(`/api/v1/products/${product.id}/convert`)
        .send({ quantity: "5", fromUomCode: "KG", toUomCode: "M" });
      expect(res.status).toBe(409);
    });

    it("6. valid product-specific kg -> m, and 16. its inverse m -> kg", async () => {
      const admin = await registerOrg(app, "CrossDim Valid Co");
      const product = await createProduct(app, admin.accessToken);
      await authed(app, admin.accessToken)
        .post(`/api/v1/products/${product.id}/conversions`)
        .send({ uomCode: "M", source: "CONFIGURED", ratio: "2.5" })
        .expect(201);

      const forward = await authed(app, admin.accessToken)
        .post(`/api/v1/products/${product.id}/convert`)
        .send({ quantity: "4", fromUomCode: "KG", toUomCode: "M" });
      expect(forward.body.quantity).toBe("10.000");

      const inverse = await authed(app, admin.accessToken)
        .post(`/api/v1/products/${product.id}/convert`)
        .send({ quantity: "10", fromUomCode: "M", toUomCode: "KG" });
      expect(inverse.body.quantity).toBe("4.000");
    });

    it("7. product-specific kg -> pcs, and chains m -> pcs through the base UOM", async () => {
      const admin = await registerOrg(app, "CrossDim Chain Co");
      const product = await createProduct(app, admin.accessToken);
      await authed(app, admin.accessToken)
        .post(`/api/v1/products/${product.id}/conversions`)
        .send({ uomCode: "M", source: "CONFIGURED", ratio: "2.5" });
      await authed(app, admin.accessToken)
        .post(`/api/v1/products/${product.id}/conversions`)
        .send({ uomCode: "PCS", source: "MEASURED", ratio: "0.5" });

      const kgToPcs = await authed(app, admin.accessToken)
        .post(`/api/v1/products/${product.id}/convert`)
        .send({ quantity: "10", fromUomCode: "KG", toUomCode: "PCS" });
      expect(kgToPcs.body.quantity).toBe("5.000");

      // Neither M nor PCS is the base UOM (KG is) — this exercises the 2-hop
      // chain: M -> KG (inverse of the M ratio) -> PCS (the PCS ratio).
      const mToPcs = await authed(app, admin.accessToken)
        .post(`/api/v1/products/${product.id}/convert`)
        .send({ quantity: "10", fromUomCode: "M", toUomCode: "PCS" });
      expect(mToPcs.body.quantity).toBe("2.000");
    });

    it("8. wrong product conversion rejected — a conversion set on Product A does not apply to Product B", async () => {
      const admin = await registerOrg(app, "CrossDim WrongProduct Co");
      const productA = await createProduct(app, admin.accessToken, { name: "Product A" });
      const productB = await createProduct(app, admin.accessToken, { name: "Product B" });
      await authed(app, admin.accessToken)
        .post(`/api/v1/products/${productA.id}/conversions`)
        .send({ uomCode: "M", source: "CONFIGURED", ratio: "2.5" });

      const res = await authed(app, admin.accessToken)
        .post(`/api/v1/products/${productB.id}/convert`)
        .send({ quantity: "5", fromUomCode: "KG", toUomCode: "M" });
      expect(res.status).toBe(409);
    });
  });

  describe("Validation", () => {
    it("10. factor = 0 is rejected", async () => {
      const admin = await registerOrg(app, "Validation Zero Co");
      const product = await createProduct(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .post(`/api/v1/products/${product.id}/conversions`)
        .send({ uomCode: "M", source: "CONFIGURED", ratio: "0" });
      expect(res.status).toBe(400);
    });

    it("11. negative factor is rejected", async () => {
      const admin = await registerOrg(app, "Validation Negative Co");
      const product = await createProduct(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .post(`/api/v1/products/${product.id}/conversions`)
        .send({ uomCode: "M", source: "CONFIGURED", ratio: "-5" });
      expect(res.status).toBe(400);
    });

    it("12. invalid UOM code is rejected", async () => {
      const admin = await registerOrg(app, "Validation InvalidUom Co");
      const product = await createProduct(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .post(`/api/v1/products/${product.id}/conversions`)
        .send({ uomCode: "XYZ", source: "CONFIGURED", ratio: "5" });
      expect(res.status).toBe(400);
    });

    it("rejects ratio supplied together with source=NOT_AVAILABLE", async () => {
      const admin = await registerOrg(app, "Validation NotAvailRatio Co");
      const product = await createProduct(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .post(`/api/v1/products/${product.id}/conversions`)
        .send({ uomCode: "M", source: "NOT_AVAILABLE", ratio: "5" });
      expect(res.status).toBe(400);
    });

    it("rejects a missing ratio when source is CONFIGURED", async () => {
      const admin = await registerOrg(app, "Validation MissingRatio Co");
      const product = await createProduct(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .post(`/api/v1/products/${product.id}/conversions`)
        .send({ uomCode: "M", source: "CONFIGURED" });
      expect(res.status).toBe(400);
    });

    it("rejects a conversion whose uomCode equals the product's base UOM", async () => {
      const admin = await registerOrg(app, "Validation SameAsBase Co");
      const product = await createProduct(app, admin.accessToken); // base = KG
      const res = await authed(app, admin.accessToken)
        .post(`/api/v1/products/${product.id}/conversions`)
        .send({ uomCode: "KG", source: "CONFIGURED", ratio: "1" });
      expect(res.status).toBe(400);
    });

    it("rejects a conversion whose uomCode is the same dimension as the base UOM (must use built-in same-dimension math instead)", async () => {
      const admin = await registerOrg(app, "Validation SameDimAsBase Co");
      const product = await createProduct(app, admin.accessToken); // base = KG (MASS)
      const res = await authed(app, admin.accessToken)
        .post(`/api/v1/products/${product.id}/conversions`)
        .send({ uomCode: "G", source: "CONFIGURED", ratio: "1000" }); // G is also MASS
      expect(res.status).toBe(400);
    });

    it("rejects a duplicate conversion for the same product+uomCode", async () => {
      const admin = await registerOrg(app, "Validation Duplicate Co");
      const product = await createProduct(app, admin.accessToken);
      await authed(app, admin.accessToken)
        .post(`/api/v1/products/${product.id}/conversions`)
        .send({ uomCode: "M", source: "CONFIGURED", ratio: "2.5" })
        .expect(201);
      const res = await authed(app, admin.accessToken)
        .post(`/api/v1/products/${product.id}/conversions`)
        .send({ uomCode: "M", source: "CONFIGURED", ratio: "3" });
      expect(res.status).toBe(409);
    });

    it("NOT_AVAILABLE creates a valid row with ratio=null — a recognized alt UOM with no coefficient yet", async () => {
      const admin = await registerOrg(app, "Validation NotAvail Co");
      const product = await createProduct(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .post(`/api/v1/products/${product.id}/conversions`)
        .send({ uomCode: "PCS", source: "NOT_AVAILABLE" });
      expect(res.status).toBe(201);
      expect(res.body.ratio).toBeNull();
      expect(res.body.source).toBe("NOT_AVAILABLE");
    });
  });

  describe("13. SERVICE product behaviour", () => {
    it("adding a conversion to a SERVICE product does not make it stockTracked", async () => {
      const admin = await registerOrg(app, "Service Conversion Co");
      const product = await createProduct(app, admin.accessToken, { productType: "SERVICE", baseUomCode: "PCS" });
      const before = await authed(app, admin.accessToken).get(`/api/v1/products/${product.id}`);
      expect(before.body.stockTracked).toBe(false);

      await authed(app, admin.accessToken)
        .post(`/api/v1/products/${product.id}/conversions`)
        .send({ uomCode: "KG", source: "CONFIGURED", ratio: "1" })
        .expect(201);

      const after = await authed(app, admin.accessToken).get(`/api/v1/products/${product.id}`);
      expect(after.body.stockTracked).toBe(false);
    });
  });

  describe("14. Decimal precision and 15. rounding", () => {
    it("stores and returns a ratio at full Decimal(18,6) precision", async () => {
      const admin = await registerOrg(app, "Precision Co");
      const product = await createProduct(app, admin.accessToken);
      const created = await authed(app, admin.accessToken)
        .post(`/api/v1/products/${product.id}/conversions`)
        .send({ uomCode: "M", source: "MEASURED", ratio: "2.123456" });
      expect(created.body.ratio).toBe("2.123456");

      const list = await authed(app, admin.accessToken).get(`/api/v1/products/${product.id}/conversions`);
      expect(list.body[0].ratio).toBe("2.123456");
    });

    it("rounds a non-terminating division result to 3 decimal places with ROUND_HALF_UP", async () => {
      const admin = await registerOrg(app, "Rounding Co");
      const product = await createProduct(app, admin.accessToken);
      await authed(app, admin.accessToken)
        .post(`/api/v1/products/${product.id}/conversions`)
        .send({ uomCode: "M", source: "CONFIGURED", ratio: "3" }); // 1 kg = 3 m
      const res = await authed(app, admin.accessToken)
        .post(`/api/v1/products/${product.id}/convert`)
        .send({ quantity: "1", fromUomCode: "M", toUomCode: "KG" }); // 1/3 = 0.333...
      expect(res.body.quantity).toBe("0.333");
    });
  });

  describe("17. Concurrent update", () => {
    it("two concurrent PATCHes on the same conversion both complete without corrupting it into an invalid state", async () => {
      const admin = await registerOrg(app, "Concurrent Update Co");
      const product = await createProduct(app, admin.accessToken);
      const created = await authed(app, admin.accessToken)
        .post(`/api/v1/products/${product.id}/conversions`)
        .send({ uomCode: "M", source: "CONFIGURED", ratio: "2" });
      const conversionId = created.body.id as string;

      const [a, b] = await Promise.all([
        authed(app, admin.accessToken)
          .patch(`/api/v1/products/${product.id}/conversions/${conversionId}`)
          .send({ ratio: "2.1" }),
        authed(app, admin.accessToken)
          .patch(`/api/v1/products/${product.id}/conversions/${conversionId}`)
          .send({ ratio: "2.2" }),
      ]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);

      const final = await authed(app, admin.accessToken).get(`/api/v1/products/${product.id}/conversions`);
      const ratio = Number(final.body[0].ratio);
      // Decimal.toString() doesn't zero-pad to the column's full scale (e.g.
      // "2.2", not "2.200000") — compare numerically, not by exact string.
      expect([2.1, 2.2]).toContain(ratio);
      expect(final.body[0].source).toBe("CONFIGURED");
    });

    it("switching source to NOT_AVAILABLE via PATCH auto-clears the ratio", async () => {
      const admin = await registerOrg(app, "Switch NotAvail Co");
      const product = await createProduct(app, admin.accessToken);
      const created = await authed(app, admin.accessToken)
        .post(`/api/v1/products/${product.id}/conversions`)
        .send({ uomCode: "M", source: "CONFIGURED", ratio: "2" });
      const updated = await authed(app, admin.accessToken)
        .patch(`/api/v1/products/${product.id}/conversions/${created.body.id}`)
        .send({ source: "NOT_AVAILABLE" });
      expect(updated.status).toBe(200);
      expect(updated.body.ratio).toBeNull();
      expect(updated.body.source).toBe("NOT_AVAILABLE");
    });
  });

  describe("18. Mass assignment protection", () => {
    it("a client-supplied confirmedById/organizationId/productId in the body is ignored", async () => {
      const admin = await registerOrg(app, "Mass Assign Conv Co");
      const product = await createProduct(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .post(`/api/v1/products/${product.id}/conversions`)
        .send({
          uomCode: "M",
          source: "CONFIGURED",
          ratio: "2.5",
          confirmedById: "attacker-user-id",
          organizationId: "some-other-org-id",
          productId: "some-other-product-id",
        });
      expect(res.status).toBe(201);
      expect(res.body.confirmedById).toBe(admin.userId);
    });
  });

  describe("RBAC", () => {
    it("EMPLOYEE can list conversions but not create them", async () => {
      const admin = await registerOrg(app, "RBAC Uom Employee Co");
      const product = await createProduct(app, admin.accessToken);
      const employee = await inviteAndLogin(app, admin, "EMPLOYEE");
      const list = await authed(app, employee.accessToken).get(`/api/v1/products/${product.id}/conversions`);
      expect(list.status).toBe(200);
      const create = await authed(app, employee.accessToken)
        .post(`/api/v1/products/${product.id}/conversions`)
        .send({ uomCode: "M", source: "CONFIGURED", ratio: "2.5" });
      expect(create.status).toBe(403);
    });

    it("PROCUREMENT_SPECIALIST cannot create/update/delete conversions (stricter than plain Product edits)", async () => {
      const admin = await registerOrg(app, "RBAC Uom Specialist Co");
      const product = await createProduct(app, admin.accessToken);
      const created = await authed(app, admin.accessToken)
        .post(`/api/v1/products/${product.id}/conversions`)
        .send({ uomCode: "M", source: "CONFIGURED", ratio: "2.5" });

      const specialist = await inviteAndLogin(app, admin, "PROCUREMENT_SPECIALIST");
      const create = await authed(app, specialist.accessToken)
        .post(`/api/v1/products/${product.id}/conversions`)
        .send({ uomCode: "PCS", source: "CONFIGURED", ratio: "1" });
      expect(create.status).toBe(403);

      const update = await authed(app, specialist.accessToken)
        .patch(`/api/v1/products/${product.id}/conversions/${created.body.id}`)
        .send({ ratio: "3" });
      expect(update.status).toBe(403);

      const remove = await authed(app, specialist.accessToken).delete(
        `/api/v1/products/${product.id}/conversions/${created.body.id}`
      );
      expect(remove.status).toBe(403);
    });

    it("PROCUREMENT_MANAGER can create/update/delete conversions", async () => {
      const admin = await registerOrg(app, "RBAC Uom Manager Co");
      const product = await createProduct(app, admin.accessToken);
      const manager = await inviteAndLogin(app, admin, "PROCUREMENT_MANAGER");
      const created = await authed(app, manager.accessToken)
        .post(`/api/v1/products/${product.id}/conversions`)
        .send({ uomCode: "M", source: "CONFIGURED", ratio: "2.5" });
      expect(created.status).toBe(201);
      const removed = await authed(app, manager.accessToken).delete(
        `/api/v1/products/${product.id}/conversions/${created.body.id}`
      );
      expect(removed.status).toBe(200);
    });
  });

  describe("9. Tenant isolation", () => {
    it("Org A cannot list/create conversions for Org B's product (404, not 403)", async () => {
      const orgA = await registerOrg(app, "Tenant Uom Co A1");
      const orgB = await registerOrg(app, "Tenant Uom Co B1");
      const productB = await createProduct(app, orgB.accessToken);

      const list = await authed(app, orgA.accessToken).get(`/api/v1/products/${productB.id}/conversions`);
      expect(list.status).toBe(404);

      const create = await authed(app, orgA.accessToken)
        .post(`/api/v1/products/${productB.id}/conversions`)
        .send({ uomCode: "M", source: "CONFIGURED", ratio: "2.5" });
      expect(create.status).toBe(404);
    });

    it("Org A cannot update/delete Org B's conversion even by guessing its id", async () => {
      const orgA = await registerOrg(app, "Tenant Uom Co A2");
      const orgB = await registerOrg(app, "Tenant Uom Co B2");
      const productB = await createProduct(app, orgB.accessToken);
      const conversionB = await authed(app, orgB.accessToken)
        .post(`/api/v1/products/${productB.id}/conversions`)
        .send({ uomCode: "M", source: "CONFIGURED", ratio: "2.5" });

      // Org A doesn't know productB's id in a real attack, but even supplying
      // it directly (worst case) must still 404 — organizationId ownership is
      // checked independently of the URL's productId value.
      const update = await authed(app, orgA.accessToken)
        .patch(`/api/v1/products/${productB.id}/conversions/${conversionB.body.id}`)
        .send({ ratio: "9.9" });
      expect(update.status).toBe(404);

      const remove = await authed(app, orgA.accessToken).delete(
        `/api/v1/products/${productB.id}/conversions/${conversionB.body.id}`
      );
      expect(remove.status).toBe(404);
    });

    it("Org A cannot use Org B's confirmed conversion via /convert", async () => {
      const orgA = await registerOrg(app, "Tenant Uom Co A3");
      const orgB = await registerOrg(app, "Tenant Uom Co B3");
      const productB = await createProduct(app, orgB.accessToken);
      await authed(app, orgB.accessToken)
        .post(`/api/v1/products/${productB.id}/conversions`)
        .send({ uomCode: "M", source: "CONFIGURED", ratio: "2.5" });

      const res = await authed(app, orgA.accessToken)
        .post(`/api/v1/products/${productB.id}/convert`)
        .send({ quantity: "5", fromUomCode: "KG", toUomCode: "M" });
      expect(res.status).toBe(404);
    });
  });
});
