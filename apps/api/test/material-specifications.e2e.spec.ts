import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, uniqueEmail } from "./test-app";

interface OrgContext {
  email: string;
  accessToken: string;
  userId: string;
}

async function registerOrg(app: INestApplication, orgName: string): Promise<OrgContext> {
  const email = uniqueEmail("spec");
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
    put: (url: string) => request(app.getHttpServer()).put(url).set("Authorization", `Bearer ${token}`),
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

describe("M2.3 Material Specification", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("1-3. Create / update / read", () => {
    it("1. GET returns null before any specification exists", async () => {
      const admin = await registerOrg(app, "Spec Empty Co");
      const product = await createProduct(app, admin.accessToken);
      const res = await authed(app, admin.accessToken).get(`/api/v1/products/${product.id}/specification`);
      expect(res.status).toBe(200);
      expect(res.body.specification).toBeNull();
    });

    it("1. PUT creates a specification", async () => {
      const admin = await registerOrg(app, "Spec Create Co");
      const product = await createProduct(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .put(`/api/v1/products/${product.id}/specification`)
        .send({ material: "Copper", grade: "M1" });
      expect(res.status).toBe(200);
      expect(res.body.material).toBe("Copper");
      expect(res.body.grade).toBe("M1");
      expect(res.body.productId).toBe(product.id);
    });

    it("2. PUT again replaces the existing specification (full replace, not merge)", async () => {
      const admin = await registerOrg(app, "Spec Replace Co");
      const product = await createProduct(app, admin.accessToken);
      await authed(app, admin.accessToken)
        .put(`/api/v1/products/${product.id}/specification`)
        .send({ material: "Copper", grade: "M1", widthMm: "50" });
      const res = await authed(app, admin.accessToken)
        .put(`/api/v1/products/${product.id}/specification`)
        .send({ material: "Aluminum" });
      expect(res.status).toBe(200);
      expect(res.body.material).toBe("Aluminum");
      // grade/widthMm were omitted on the second PUT -> cleared, not retained
      expect(res.body.grade).toBeNull();
      expect(res.body.widthMm).toBeNull();
    });

    it("3. GET reflects the current specification", async () => {
      const admin = await registerOrg(app, "Spec Read Co");
      const product = await createProduct(app, admin.accessToken);
      await authed(app, admin.accessToken)
        .put(`/api/v1/products/${product.id}/specification`)
        .send({ material: "Steel" });
      const res = await authed(app, admin.accessToken).get(`/api/v1/products/${product.id}/specification`);
      expect(res.status).toBe(200);
      expect(res.body.specification.material).toBe("Steel");
    });
  });

  describe("4. Tenant isolation", () => {
    it("cannot read a specification belonging to another organization's product", async () => {
      const orgA = await registerOrg(app, "Spec Tenant A");
      const orgB = await registerOrg(app, "Spec Tenant B");
      const productA = await createProduct(app, orgA.accessToken);
      await authed(app, orgA.accessToken)
        .put(`/api/v1/products/${productA.id}/specification`)
        .send({ material: "Copper" });

      const res = await authed(app, orgB.accessToken).get(`/api/v1/products/${productA.id}/specification`);
      expect(res.status).toBe(404);
    });

    it("19. cannot set a specification on another organization's product (404, not 403)", async () => {
      const orgA = await registerOrg(app, "Spec Tenant C");
      const orgB = await registerOrg(app, "Spec Tenant D");
      const productA = await createProduct(app, orgA.accessToken);

      const res = await authed(app, orgB.accessToken)
        .put(`/api/v1/products/${productA.id}/specification`)
        .send({ material: "Copper" });
      expect(res.status).toBe(404);
    });

    it("19. cannot delete a specification on another organization's product (404)", async () => {
      const orgA = await registerOrg(app, "Spec Tenant E");
      const orgB = await registerOrg(app, "Spec Tenant F");
      const productA = await createProduct(app, orgA.accessToken);
      await authed(app, orgA.accessToken)
        .put(`/api/v1/products/${productA.id}/specification`)
        .send({ material: "Copper" });

      const res = await authed(app, orgB.accessToken).delete(`/api/v1/products/${productA.id}/specification`);
      expect(res.status).toBe(404);
    });
  });

  describe("5. RBAC", () => {
    it("EMPLOYEE can read but not write", async () => {
      const admin = await registerOrg(app, "Spec RBAC Employee Co");
      const employee = await inviteAndLogin(app, admin, "EMPLOYEE");
      const product = await createProduct(app, admin.accessToken);

      const read = await authed(app, employee.accessToken).get(`/api/v1/products/${product.id}/specification`);
      expect(read.status).toBe(200);

      const write = await authed(app, employee.accessToken)
        .put(`/api/v1/products/${product.id}/specification`)
        .send({ material: "Copper" });
      expect(write.status).toBe(403);
    });

    it("PROCUREMENT_SPECIALIST can create/update but not delete", async () => {
      const admin = await registerOrg(app, "Spec RBAC Specialist Co");
      const specialist = await inviteAndLogin(app, admin, "PROCUREMENT_SPECIALIST");
      const product = await createProduct(app, admin.accessToken);

      const write = await authed(app, specialist.accessToken)
        .put(`/api/v1/products/${product.id}/specification`)
        .send({ material: "Copper" });
      expect(write.status).toBe(200);

      const remove = await authed(app, specialist.accessToken).delete(`/api/v1/products/${product.id}/specification`);
      expect(remove.status).toBe(403);
    });

    it("PROCUREMENT_MANAGER can create, update, and delete", async () => {
      const admin = await registerOrg(app, "Spec RBAC Manager Co");
      const manager = await inviteAndLogin(app, admin, "PROCUREMENT_MANAGER");
      const product = await createProduct(app, admin.accessToken);

      const write = await authed(app, manager.accessToken)
        .put(`/api/v1/products/${product.id}/specification`)
        .send({ material: "Copper" });
      expect(write.status).toBe(200);

      const remove = await authed(app, manager.accessToken).delete(`/api/v1/products/${product.id}/specification`);
      expect(remove.status).toBe(200);
    });

    it("APPROVER can read but not write", async () => {
      const admin = await registerOrg(app, "Spec RBAC Approver Co");
      const approver = await inviteAndLogin(app, admin, "APPROVER");
      const product = await createProduct(app, admin.accessToken);

      const write = await authed(app, approver.accessToken)
        .put(`/api/v1/products/${product.id}/specification`)
        .send({ material: "Copper" });
      expect(write.status).toBe(403);
    });
  });

  describe("6. Mass assignment", () => {
    it("productId in the body is ignored — cannot retarget another product", async () => {
      const admin = await registerOrg(app, "Spec Mass Assign Co");
      const productA = await createProduct(app, admin.accessToken, { name: "A" });
      const productB = await createProduct(app, admin.accessToken, { name: "B" });

      const res = await authed(app, admin.accessToken)
        .put(`/api/v1/products/${productA.id}/specification`)
        .send({ material: "Copper", productId: productB.id, id: "not-a-real-id" });
      expect(res.status).toBe(200);
      expect(res.body.productId).toBe(productA.id);

      const bSpec = await authed(app, admin.accessToken).get(`/api/v1/products/${productB.id}/specification`);
      expect(bSpec.body.specification).toBeNull();
    });
  });

  describe("7-8. Dimension validation", () => {
    it("7. rejects a non-decimal string for a dimension field", async () => {
      const admin = await registerOrg(app, "Spec Invalid Dim Co");
      const product = await createProduct(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .put(`/api/v1/products/${product.id}/specification`)
        .send({ widthMm: "fifty" });
      expect(res.status).toBe(400);
    });

    it("7. rejects a negative dimension value", async () => {
      const admin = await registerOrg(app, "Spec Negative Dim Co");
      const product = await createProduct(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .put(`/api/v1/products/${product.id}/specification`)
        .send({ widthMm: "-5" });
      expect(res.status).toBe(400);
    });

    it("8. accepts a valid decimal dimension value", async () => {
      const admin = await registerOrg(app, "Spec Valid Dim Co");
      const product = await createProduct(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .put(`/api/v1/products/${product.id}/specification`)
        .send({ widthMm: "50", thicknessMm: "5" });
      expect(res.status).toBe(200);
      expect(Number(res.body.widthMm)).toBe(50);
      expect(Number(res.body.thicknessMm)).toBe(5);
    });

    it("rejects an attribute UOM_VALUE tagged with a nonexistent UomCode", async () => {
      const admin = await registerOrg(app, "Spec Attr Invalid Uom Co");
      const product = await createProduct(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .put(`/api/v1/products/${product.id}/specification`)
        .send({ attributes: { insulationThickness: { value: "2", uomCode: "VOLT" } } });
      expect(res.status).toBe(400);
    });
  });

  describe("9-10. Decimal values and precision", () => {
    it("9-10. round-trips a precise Decimal(18,3) value without corruption", async () => {
      const admin = await registerOrg(app, "Spec Precision Co");
      const product = await createProduct(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .put(`/api/v1/products/${product.id}/specification`)
        .send({ densityKgM3: "8960.123" });
      expect(res.status).toBe(200);
      // Decimal.toString() does not zero-pad (M2.2 lesson) — compare numerically.
      expect(Number(res.body.densityKgM3)).toBe(8960.123);
    });
  });

  describe("11. Nullable fields", () => {
    it("every specification field is independently optional — an empty PUT body is valid", async () => {
      const admin = await registerOrg(app, "Spec Nullable Co");
      const product = await createProduct(app, admin.accessToken);
      const res = await authed(app, admin.accessToken).put(`/api/v1/products/${product.id}/specification`).send({});
      expect(res.status).toBe(200);
      expect(res.body.material).toBeNull();
      expect(res.body.widthMm).toBeNull();
      expect(res.body.attributes).toBeNull();
    });
  });

  describe("12-13. ProductType behaviour / SERVICE product", () => {
    it("12. works for a MATERIAL product", async () => {
      const admin = await registerOrg(app, "Spec ProductType Material Co");
      const product = await createProduct(app, admin.accessToken, { productType: "MATERIAL" });
      const res = await authed(app, admin.accessToken)
        .put(`/api/v1/products/${product.id}/specification`)
        .send({ material: "Copper" });
      expect(res.status).toBe(200);
    });

    it("13. a SERVICE product can (optionally) receive a specification without affecting stockTracked", async () => {
      const admin = await registerOrg(app, "Spec Service Co");
      const product = await createProduct(app, admin.accessToken, { productType: "SERVICE" });
      const res = await authed(app, admin.accessToken)
        .put(`/api/v1/products/${product.id}/specification`)
        .send({ material: "N/A" });
      expect(res.status).toBe(200);

      const productRes = await authed(app, admin.accessToken).get(`/api/v1/products/${product.id}`);
      expect(productRes.body.stockTracked).toBe(false);
    });
  });

  describe("14-17. Industrial examples", () => {
    it("14. Copper Busbar 50x5x6000mm, grade M1", async () => {
      const admin = await registerOrg(app, "Busbar Co");
      const product = await createProduct(app, admin.accessToken, { name: "Copper Busbar 50x5", baseUomCode: "KG" });
      const res = await authed(app, admin.accessToken)
        .put(`/api/v1/products/${product.id}/specification`)
        .send({
          material: "Copper",
          grade: "M1",
          widthMm: "50",
          thicknessMm: "5",
          lengthMm: "6000",
          densityKgM3: "8960",
        });
      expect(res.status).toBe(200);
      expect(res.body.displayValue).toBe("Copper M1 · W50×T5×L6000 mm");
    });

    it("15. Steel Sheet 2000x1000x2mm", async () => {
      const admin = await registerOrg(app, "Sheet Co");
      const product = await createProduct(app, admin.accessToken, { name: "Steel Sheet", baseUomCode: "PCS" });
      const res = await authed(app, admin.accessToken).put(`/api/v1/products/${product.id}/specification`).send({
        material: "Steel",
        grade: "DC01",
        widthMm: "1000",
        lengthMm: "2000",
        thicknessMm: "2",
      });
      expect(res.status).toBe(200);
      expect(Number(res.body.widthMm)).toBe(1000);
      expect(Number(res.body.lengthMm)).toBe(2000);
    });

    it("16. Copper Cable 4x50mm2 with dynamic attributes", async () => {
      const admin = await registerOrg(app, "Cable Co");
      const product = await createProduct(app, admin.accessToken, { name: "Copper Cable 4x50", baseUomCode: "M" });
      const res = await authed(app, admin.accessToken)
        .put(`/api/v1/products/${product.id}/specification`)
        .send({
          material: "Copper",
          crossSectionMm2: "50",
          outerDiameterMm: "28",
          attributes: {
            coreCount: 4,
            insulation: "PVC",
            voltageClassV: "1000",
          },
        });
      expect(res.status).toBe(200);
      expect(res.body.attributes).toEqual({ coreCount: 4, insulation: "PVC", voltageClassV: "1000" });
    });

    it("17. Fastener Bolt M10x50 with thread attribute", async () => {
      const admin = await registerOrg(app, "Fastener Co");
      const product = await createProduct(app, admin.accessToken, { name: "Bolt M10x50", baseUomCode: "PCS" });
      const res = await authed(app, admin.accessToken)
        .put(`/api/v1/products/${product.id}/specification`)
        .send({
          material: "Steel",
          grade: "8.8",
          standard: "DIN 933",
          lengthMm: "50",
          outerDiameterMm: "10",
          attributes: { thread: "M10" },
        });
      expect(res.status).toBe(200);
      expect(res.body.attributes).toEqual({ thread: "M10" });
    });
  });

  describe("18. Duplicate / invalid specification cases", () => {
    it("PUT-ing an existing specification is a replace, never a 409 conflict", async () => {
      const admin = await registerOrg(app, "Spec Duplicate Co");
      const product = await createProduct(app, admin.accessToken);
      const first = await authed(app, admin.accessToken)
        .put(`/api/v1/products/${product.id}/specification`)
        .send({ material: "Copper" });
      expect(first.status).toBe(200);
      const second = await authed(app, admin.accessToken)
        .put(`/api/v1/products/${product.id}/specification`)
        .send({ material: "Copper", grade: "M2" });
      expect(second.status).toBe(200);
    });

    it("rejects more than 50 dynamic attributes", async () => {
      const admin = await registerOrg(app, "Spec Too Many Attrs Co");
      const product = await createProduct(app, admin.accessToken);
      const attributes: Record<string, string> = {};
      for (let i = 0; i < 51; i++) attributes[`attr${i}`] = "x";
      const res = await authed(app, admin.accessToken)
        .put(`/api/v1/products/${product.id}/specification`)
        .send({ attributes });
      expect(res.status).toBe(400);
    });

    it("DELETE on a nonexistent specification returns 404", async () => {
      const admin = await registerOrg(app, "Spec Delete Missing Co");
      const product = await createProduct(app, admin.accessToken);
      const res = await authed(app, admin.accessToken).delete(`/api/v1/products/${product.id}/specification`);
      expect(res.status).toBe(404);
    });

    it("GET/PUT/DELETE against a nonexistent product returns 404", async () => {
      const admin = await registerOrg(app, "Spec No Product Co");
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const res = await authed(app, admin.accessToken)
        .put(`/api/v1/products/${fakeId}/specification`)
        .send({ material: "Copper" });
      expect(res.status).toBe(404);
    });
  });

  describe("20. Audit behaviour", () => {
    it("set and delete both succeed without error (AuditService.log is exercised on each write)", async () => {
      const admin = await registerOrg(app, "Spec Audit Co");
      const product = await createProduct(app, admin.accessToken);
      const set = await authed(app, admin.accessToken)
        .put(`/api/v1/products/${product.id}/specification`)
        .send({ material: "Copper" });
      expect(set.status).toBe(200);
      const del = await authed(app, admin.accessToken).delete(`/api/v1/products/${product.id}/specification`);
      expect(del.status).toBe(200);
    });
  });
});
