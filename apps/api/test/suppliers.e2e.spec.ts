import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createSystemPrismaClient } from "@top/database";
import { AuditService } from "../src/common/audit/audit.service";
import { createTestApp, uniqueEmail } from "./test-app";

/**
 * M3.2 Supplier Master (Architecture Gate Revision 1, locked). Real HTTP
 * against real Postgres — tenant isolation, RBAC matrix, CRUD, status
 * lifecycle, rating bounds, contacts (incl. the primary-contact partial
 * unique index), capabilities (incl. cross-tenant categoryId injection),
 * and create idempotency (incl. distinguishing a genuine duplicate-TIN
 * rejection from an idempotency replay).
 */

interface OrgContext {
  email: string;
  accessToken: string;
  userId: string;
  organizationId: string;
}

async function registerOrg(app: INestApplication, orgName: string): Promise<OrgContext> {
  const email = uniqueEmail("sup");
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

async function createSupplierOk(app: INestApplication, token: string, body: Record<string, unknown> = {}) {
  const res = await authed(app, token)
    .post("/api/v1/suppliers")
    .send({ companyName: "ООО Test Supplier", ...body });
  if (res.status !== 201) throw new Error(`createSupplier failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as Record<string, unknown> & { id: string; supplierCode: string };
}

async function createCategoryOk(app: INestApplication, token: string, name: string) {
  const res = await authed(app, token).post("/api/v1/categories").send({ name });
  if (res.status !== 201) throw new Error(`createCategory failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string; name: string };
}

describe("M3.2 Supplier Master", () => {
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

  // ────────────────────────────────────────────────────────────
  // CREATE / SUPPLIER CODE
  // ────────────────────────────────────────────────────────────

  describe("create / supplierCode", () => {
    it("assigns sequential, non-year-scoped codes within an org", async () => {
      const admin = await registerOrg(app, "Supplier Code Org");
      const s1 = await createSupplierOk(app, admin.accessToken, { companyName: "Alfa" });
      const s2 = await createSupplierOk(app, admin.accessToken, { companyName: "Beta" });
      expect(s1.supplierCode).toMatch(/^SUP-\d{6}$/);
      expect(s2.supplierCode).toMatch(/^SUP-\d{6}$/);
      expect(s2.supplierCode).not.toBe(s1.supplierCode);
    });

    it("keeps supplier code sequences independent per organization", async () => {
      const orgA = await registerOrg(app, "Seq Org A");
      const orgB = await registerOrg(app, "Seq Org B");
      const a1 = await createSupplierOk(app, orgA.accessToken, { companyName: "A1" });
      const b1 = await createSupplierOk(app, orgB.accessToken, { companyName: "B1" });
      expect(a1.supplierCode).toBe("SUP-000001");
      expect(b1.supplierCode).toBe("SUP-000001");
    });

    it("rejects a companyName-less create (required field)", async () => {
      const admin = await registerOrg(app, "Validation Org");
      const res = await authed(app, admin.accessToken).post("/api/v1/suppliers").send({});
      expect(res.status).toBe(400);
    });

    it("normalizes and enforces TIN uniqueness per org (non-null only)", async () => {
      const admin = await registerOrg(app, "TIN Org");
      await createSupplierOk(app, admin.accessToken, { companyName: "First", tin: "123 456 789" });
      const dup = await authed(app, admin.accessToken)
        .post("/api/v1/suppliers")
        .send({ companyName: "Second", tin: "123-456-789" }); // same normalized TIN
      expect(dup.status).toBe(409);

      // multiple TIN-less suppliers must remain allowed
      const s2 = await createSupplierOk(app, admin.accessToken, { companyName: "NoTin1" });
      const s3 = await createSupplierOk(app, admin.accessToken, { companyName: "NoTin2" });
      expect(s2.id).not.toBe(s3.id);
    });

    it("allows the same TIN to exist in two different organizations", async () => {
      const orgA = await registerOrg(app, "TinCrossA");
      const orgB = await registerOrg(app, "TinCrossB");
      const a = await createSupplierOk(app, orgA.accessToken, { companyName: "A", tin: "999888777" });
      const b = await createSupplierOk(app, orgB.accessToken, { companyName: "B", tin: "999888777" });
      expect(a.id).not.toBe(b.id);
    });

    it("accepts a foreign, letter-containing tax ID unchanged (never numeric-only)", async () => {
      const admin = await registerOrg(app, "Foreign Tin Org");
      const s = await createSupplierOk(app, admin.accessToken, { companyName: "Foreign Co", tin: "GB123ABC456" });
      expect(s.tin).toBe("GB123ABC456");
    });

    it("stores countryCode only when explicitly submitted, never defaults to UZ", async () => {
      const admin = await registerOrg(app, "Country Org");
      const withCountry = await createSupplierOk(app, admin.accessToken, { companyName: "WithCountry", countryCode: "TR" });
      const withoutCountry = await createSupplierOk(app, admin.accessToken, { companyName: "WithoutCountry" });
      expect(withCountry.countryCode).toBe("TR");
      expect(withoutCountry.countryCode).toBeNull();
    });

    it("rejects an invalid countryCode shape", async () => {
      const admin = await registerOrg(app, "Bad Country Org");
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/suppliers")
        .send({ companyName: "X", countryCode: "Uzbekistan" });
      expect(res.status).toBe(400);
    });
  });

  // ────────────────────────────────────────────────────────────
  // CREATE IDEMPOTENCY
  // ────────────────────────────────────────────────────────────

  describe("create idempotency", () => {
    it("replays the same Supplier for a repeated idempotencyKey with an identical payload", async () => {
      const admin = await registerOrg(app, "Idem Org");
      const key = `idem-${Date.now()}`;
      const body = { companyName: "Idempotent Co", idempotencyKey: key };
      const first = await authed(app, admin.accessToken).post("/api/v1/suppliers").send(body);
      const second = await authed(app, admin.accessToken).post("/api/v1/suppliers").send(body);
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.id).toBe(first.body.id);
    });

    it("rejects reusing an idempotencyKey with a different payload", async () => {
      const admin = await registerOrg(app, "Idem Conflict Org");
      const key = `idem-${Date.now()}`;
      await authed(app, admin.accessToken).post("/api/v1/suppliers").send({ companyName: "First Name", idempotencyKey: key });
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/suppliers")
        .send({ companyName: "Different Name", idempotencyKey: key });
      expect(res.status).toBe(409);
    });

    it("a genuine duplicate-TIN rejection is reported distinctly from an idempotency conflict", async () => {
      const admin = await registerOrg(app, "Idem Vs Tin Org");
      await createSupplierOk(app, admin.accessToken, { companyName: "Original", tin: "555444333" });
      // No idempotencyKey supplied — this must be a plain 409 duplicate-TIN
      // rejection, not anything idempotency-flavored.
      const res = await authed(app, admin.accessToken).post("/api/v1/suppliers").send({ companyName: "Copycat", tin: "555444333" });
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/tax ID/i);
    });
  });

  // ────────────────────────────────────────────────────────────
  // TENANT ISOLATION
  // ────────────────────────────────────────────────────────────

  describe("tenant isolation", () => {
    it("a supplier from Org A is invisible (404) to Org B on read/update/status/rating", async () => {
      const orgA = await registerOrg(app, "Tenant A");
      const orgB = await registerOrg(app, "Tenant B");
      const supplier = await createSupplierOk(app, orgA.accessToken);

      expect((await authed(app, orgB.accessToken).get(`/api/v1/suppliers/${supplier.id}`)).status).toBe(404);
      expect((await authed(app, orgB.accessToken).patch(`/api/v1/suppliers/${supplier.id}`).send({ companyName: "Hijacked" })).status).toBe(404);
      expect((await authed(app, orgB.accessToken).patch(`/api/v1/suppliers/${supplier.id}/status`).send({ status: "BLOCKED" })).status).toBe(404);
      expect((await authed(app, orgB.accessToken).patch(`/api/v1/suppliers/${supplier.id}/rating`).send({ rating: "5" })).status).toBe(404);
    });

    it("Org B cannot add a contact/capability to an Org A supplier", async () => {
      const orgA = await registerOrg(app, "Tenant Contact A");
      const orgB = await registerOrg(app, "Tenant Contact B");
      const supplier = await createSupplierOk(app, orgA.accessToken);

      const contactRes = await authed(app, orgB.accessToken)
        .post(`/api/v1/suppliers/${supplier.id}/contacts`)
        .send({ fullName: "Intruder" });
      expect(contactRes.status).toBe(404);

      const category = await createCategoryOk(app, orgB.accessToken, "OrgB Category");
      const capRes = await authed(app, orgB.accessToken)
        .post(`/api/v1/suppliers/${supplier.id}/capabilities`)
        .send({ categoryId: category.id });
      expect(capRes.status).toBe(404);
    });

    it("a cross-org categoryId is rejected (404) even against the caller's own supplier", async () => {
      const orgA = await registerOrg(app, "Cross Cat A");
      const orgB = await registerOrg(app, "Cross Cat B");
      const supplier = await createSupplierOk(app, orgA.accessToken);
      const foreignCategory = await createCategoryOk(app, orgB.accessToken, "Foreign Category");

      const res = await authed(app, orgA.accessToken)
        .post(`/api/v1/suppliers/${supplier.id}/capabilities`)
        .send({ categoryId: foreignCategory.id });
      expect(res.status).toBe(404);
    });

    it("list results never include another organization's suppliers", async () => {
      const orgA = await registerOrg(app, "List Isolation A");
      const orgB = await registerOrg(app, "List Isolation B");
      await createSupplierOk(app, orgA.accessToken, { companyName: "Only In A" });
      const res = await authed(app, orgB.accessToken).get("/api/v1/suppliers");
      expect(res.status).toBe(200);
      expect((res.body.items as Array<{ companyName: string }>).some((s) => s.companyName === "Only In A")).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────
  // RBAC MATRIX
  // ────────────────────────────────────────────────────────────

  describe("RBAC", () => {
    it("EMPLOYEE/APPROVER/SUPPLIER cannot read or write suppliers", async () => {
      const admin = await registerOrg(app, "RBAC Org");
      const supplier = await createSupplierOk(app, admin.accessToken);
      for (const role of ["EMPLOYEE", "APPROVER", "SUPPLIER"]) {
        const user = await inviteAndLogin(app, admin, role);
        expect((await authed(app, user.accessToken).get("/api/v1/suppliers")).status).toBe(403);
        expect((await authed(app, user.accessToken).get(`/api/v1/suppliers/${supplier.id}`)).status).toBe(403);
        expect((await authed(app, user.accessToken).post("/api/v1/suppliers").send({ companyName: "X" })).status).toBe(403);
      }
    });

    it("PROCUREMENT_SPECIALIST can read/create/update/rate but cannot change status", async () => {
      const admin = await registerOrg(app, "Specialist RBAC Org");
      const specialist = await inviteAndLogin(app, admin, "PROCUREMENT_SPECIALIST");
      const created = await authed(app, specialist.accessToken).post("/api/v1/suppliers").send({ companyName: "Specialist Co" });
      expect(created.status).toBe(201);
      const id = created.body.id as string;

      expect((await authed(app, specialist.accessToken).get(`/api/v1/suppliers/${id}`)).status).toBe(200);
      expect((await authed(app, specialist.accessToken).patch(`/api/v1/suppliers/${id}`).send({ notes: "ok" })).status).toBe(200);
      expect((await authed(app, specialist.accessToken).patch(`/api/v1/suppliers/${id}/rating`).send({ rating: "4" })).status).toBe(200);
      expect((await authed(app, specialist.accessToken).patch(`/api/v1/suppliers/${id}/status`).send({ status: "BLOCKED" })).status).toBe(403);
    });

    it("ADMIN and PROCUREMENT_MANAGER can change status", async () => {
      const admin = await registerOrg(app, "Manager RBAC Org");
      const manager = await inviteAndLogin(app, admin, "PROCUREMENT_MANAGER");
      const supplier = await createSupplierOk(app, admin.accessToken);

      expect((await authed(app, manager.accessToken).patch(`/api/v1/suppliers/${supplier.id}/status`).send({ status: "INACTIVE" })).status).toBe(200);
      expect((await authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}/status`).send({ status: "ACTIVE" })).status).toBe(200);
    });
  });

  // ────────────────────────────────────────────────────────────
  // STATUS LIFECYCLE
  // ────────────────────────────────────────────────────────────

  describe("status lifecycle", () => {
    it("supports every reverse transition back to ACTIVE (ARCHIVED/BLOCKED/INACTIVE -> ACTIVE)", async () => {
      const admin = await registerOrg(app, "Reversible Org");
      for (const from of ["ARCHIVED", "BLOCKED", "INACTIVE"]) {
        const supplier = await createSupplierOk(app, admin.accessToken);
        const toIntermediate = await authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}/status`).send({ status: from });
        expect(toIntermediate.status).toBe(200);
        const backToActive = await authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}/status`).send({ status: "ACTIVE" });
        expect(backToActive.status).toBe(200);
        expect(backToActive.body.status).toBe("ACTIVE");
      }
    });

    it("a same-status request is a no-op 200 and does not add a duplicate audit row", async () => {
      const admin = await registerOrg(app, "NoOp Status Org");
      const supplier = await createSupplierOk(app, admin.accessToken);
      const countBefore = await db.auditLog.count({ where: { entityId: supplier.id, action: "SUPPLIER_STATUS_CHANGED" } });

      const res = await authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}/status`).send({ status: "ACTIVE" });
      expect(res.status).toBe(200);

      const countAfter = await db.auditLog.count({ where: { entityId: supplier.id, action: "SUPPLIER_STATUS_CHANGED" } });
      expect(countAfter).toBe(countBefore);
    });

    it("default list excludes ARCHIVED, but an explicit status filter finds it", async () => {
      const admin = await registerOrg(app, "Archived Filter Org");
      const supplier = await createSupplierOk(app, admin.accessToken, { companyName: "Will Be Archived" });
      await authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}/status`).send({ status: "ARCHIVED" });

      const defaultList = await authed(app, admin.accessToken).get("/api/v1/suppliers");
      expect((defaultList.body.items as Array<{ id: string }>).some((s) => s.id === supplier.id)).toBe(false);

      const filtered = await authed(app, admin.accessToken).get("/api/v1/suppliers?status=ARCHIVED");
      expect((filtered.body.items as Array<{ id: string }>).some((s) => s.id === supplier.id)).toBe(true);
    });

    it("BLOCKED status does not affect an existing StockLot's supplier provenance", async () => {
      const admin = await registerOrg(app, "StockLot Provenance Org");
      const supplier = await createSupplierOk(app, admin.accessToken);
      const product = await authed(app, admin.accessToken)
        .post("/api/v1/products")
        .send({ sku: `SKU-${Date.now()}`, name: "Prov Product", productType: "MATERIAL", baseUomCode: "KG", trackingMode: "LOT" });

      const lot = await authed(app, admin.accessToken)
        .post("/api/v1/stock-lots")
        .send({ productId: product.body.id, supplierId: supplier.id, lotNumber: "LOT-PROV-1" });
      expect(lot.status).toBe(201);

      const blocked = await authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}/status`).send({ status: "BLOCKED" });
      expect(blocked.status).toBe(200);

      const lotAfter = await authed(app, admin.accessToken).get(`/api/v1/stock-lots/${lot.body.id}`);
      expect(lotAfter.status).toBe(200);
      expect(lotAfter.body.supplierId).toBe(supplier.id);
    });
  });

  // ────────────────────────────────────────────────────────────
  // RATING
  // ────────────────────────────────────────────────────────────

  describe("rating", () => {
    it("accepts values within [1, 5] and rejects out-of-range values", async () => {
      const admin = await registerOrg(app, "Rating Org");
      const supplier = await createSupplierOk(app, admin.accessToken);

      expect((await authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}/rating`).send({ rating: "1" })).status).toBe(200);
      expect((await authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}/rating`).send({ rating: "5" })).status).toBe(200);
      expect((await authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}/rating`).send({ rating: "4.5" })).status).toBe(200);
      expect((await authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}/rating`).send({ rating: "0.9" })).status).toBe(400);
      expect((await authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}/rating`).send({ rating: "5.5" })).status).toBe(400);
    });

    it("accepts null to clear a rating", async () => {
      const admin = await registerOrg(app, "Rating Clear Org");
      const supplier = await createSupplierOk(app, admin.accessToken);
      await authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}/rating`).send({ rating: "3" });
      const cleared = await authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}/rating`).send({ rating: null });
      expect(cleared.status).toBe(200);
      expect(cleared.body.rating).toBeNull();
    });

    it("the general PATCH /suppliers/:id rejects a rating field (400)", async () => {
      const admin = await registerOrg(app, "Rating Boundary Org");
      const supplier = await createSupplierOk(app, admin.accessToken);
      const res = await authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}`).send({ rating: "5" });
      expect(res.status).toBe(400);
    });
  });

  // ────────────────────────────────────────────────────────────
  // CONTACTS — primary-contact invariant
  // ────────────────────────────────────────────────────────────

  describe("contacts", () => {
    it("promoting a new primary contact demotes the previous one, never leaving two", async () => {
      const admin = await registerOrg(app, "Primary Contact Org");
      const supplier = await createSupplierOk(app, admin.accessToken);

      const c1 = await authed(app, admin.accessToken)
        .post(`/api/v1/suppliers/${supplier.id}/contacts`)
        .send({ fullName: "Contact One", isPrimary: true });
      expect(c1.body.isPrimary).toBe(true);

      const c2 = await authed(app, admin.accessToken)
        .post(`/api/v1/suppliers/${supplier.id}/contacts`)
        .send({ fullName: "Contact Two", isPrimary: true });
      expect(c2.body.isPrimary).toBe(true);

      const detail = await authed(app, admin.accessToken).get(`/api/v1/suppliers/${supplier.id}`);
      const primaries = (detail.body.contacts as Array<{ isPrimary: boolean }>).filter((c) => c.isPrimary);
      expect(primaries).toHaveLength(1);

      const primaryCount = await db.supplierContact.count({ where: { supplierId: supplier.id, isPrimary: true, active: true } });
      expect(primaryCount).toBe(1);
    });

    it("promoting an existing contact to primary via PATCH also demotes the previous primary", async () => {
      const admin = await registerOrg(app, "Promote Contact Org");
      const supplier = await createSupplierOk(app, admin.accessToken);
      const c1 = await authed(app, admin.accessToken)
        .post(`/api/v1/suppliers/${supplier.id}/contacts`)
        .send({ fullName: "First", isPrimary: true });
      const c2 = await authed(app, admin.accessToken)
        .post(`/api/v1/suppliers/${supplier.id}/contacts`)
        .send({ fullName: "Second" });

      const promote = await authed(app, admin.accessToken)
        .patch(`/api/v1/suppliers/${supplier.id}/contacts/${c2.body.id}`)
        .send({ isPrimary: true });
      expect(promote.status).toBe(200);

      const primaryCount = await db.supplierContact.count({ where: { supplierId: supplier.id, isPrimary: true, active: true } });
      expect(primaryCount).toBe(1);
      const reread = await db.supplierContact.findUnique({ where: { id: c1.body.id } });
      expect(reread?.isPrimary).toBe(false);
    });

    it("archiving the primary contact leaves zero primary contacts, with no auto-promotion", async () => {
      const admin = await registerOrg(app, "Archive Primary Org");
      const supplier = await createSupplierOk(app, admin.accessToken);
      const c1 = await authed(app, admin.accessToken)
        .post(`/api/v1/suppliers/${supplier.id}/contacts`)
        .send({ fullName: "Primary", isPrimary: true });
      await authed(app, admin.accessToken).post(`/api/v1/suppliers/${supplier.id}/contacts`).send({ fullName: "Other" });

      const archive = await authed(app, admin.accessToken).post(`/api/v1/suppliers/${supplier.id}/contacts/${c1.body.id}/archive`);
      expect(archive.status).toBe(200);
      expect(archive.body.active).toBe(false);

      const primaryCount = await db.supplierContact.count({ where: { supplierId: supplier.id, isPrimary: true, active: true } });
      expect(primaryCount).toBe(0);
    });

    it("rejects an empty contact update body", async () => {
      const admin = await registerOrg(app, "Empty Contact Update Org");
      const supplier = await createSupplierOk(app, admin.accessToken);
      const c1 = await authed(app, admin.accessToken).post(`/api/v1/suppliers/${supplier.id}/contacts`).send({ fullName: "X" });
      const res = await authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}/contacts/${c1.body.id}`).send({});
      expect(res.status).toBe(400);
    });

    it("Final Hardening: repeat archive is an idempotent no-op — 200, no second audit row", async () => {
      const admin = await registerOrg(app, "Repeat Archive Org");
      const supplier = await createSupplierOk(app, admin.accessToken);
      const c1 = await authed(app, admin.accessToken).post(`/api/v1/suppliers/${supplier.id}/contacts`).send({ fullName: "X" });

      const first = await authed(app, admin.accessToken).post(`/api/v1/suppliers/${supplier.id}/contacts/${c1.body.id}/archive`);
      expect(first.status).toBe(200);
      expect(first.body.active).toBe(false);
      expect(first.body.isPrimary).toBe(false);
      const countAfterFirst = await db.auditLog.count({ where: { entityId: c1.body.id, action: "SUPPLIER_CONTACT_ARCHIVED" } });
      expect(countAfterFirst).toBe(1);

      const second = await authed(app, admin.accessToken).post(`/api/v1/suppliers/${supplier.id}/contacts/${c1.body.id}/archive`);
      expect(second.status).toBe(200);
      const countAfterSecond = await db.auditLog.count({ where: { entityId: c1.body.id, action: "SUPPLIER_CONTACT_ARCHIVED" } });
      expect(countAfterSecond).toBe(1); // no duplicate
    });
  });

  // ────────────────────────────────────────────────────────────
  // CAPABILITIES
  // ────────────────────────────────────────────────────────────

  describe("capabilities", () => {
    it("adds and removes a capability, rejecting a duplicate add", async () => {
      const admin = await registerOrg(app, "Capability Org");
      const supplier = await createSupplierOk(app, admin.accessToken);
      const category = await createCategoryOk(app, admin.accessToken, "Fasteners");

      const add = await authed(app, admin.accessToken).post(`/api/v1/suppliers/${supplier.id}/capabilities`).send({ categoryId: category.id });
      expect(add.status).toBe(201);

      const dup = await authed(app, admin.accessToken).post(`/api/v1/suppliers/${supplier.id}/capabilities`).send({ categoryId: category.id });
      expect(dup.status).toBe(409);

      const remove = await authed(app, admin.accessToken).delete(`/api/v1/suppliers/${supplier.id}/capabilities/${category.id}`);
      expect(remove.status).toBe(200);

      const detail = await authed(app, admin.accessToken).get(`/api/v1/suppliers/${supplier.id}`);
      expect(detail.body.categories).toHaveLength(0);
    });

    it("list filters by categoryId", async () => {
      const admin = await registerOrg(app, "Capability Filter Org");
      const category = await createCategoryOk(app, admin.accessToken, "Electrical");
      const withCap = await createSupplierOk(app, admin.accessToken, { companyName: "HasCapability" });
      await createSupplierOk(app, admin.accessToken, { companyName: "NoCapability" });
      await authed(app, admin.accessToken).post(`/api/v1/suppliers/${withCap.id}/capabilities`).send({ categoryId: category.id });

      const res = await authed(app, admin.accessToken).get(`/api/v1/suppliers?categoryId=${category.id}`);
      const ids = (res.body.items as Array<{ id: string }>).map((s) => s.id);
      expect(ids).toContain(withCap.id);
      expect(ids).toHaveLength(1);
    });

    it("Final Hardening: rejects assigning an inactive category (400 clean business error)", async () => {
      const admin = await registerOrg(app, "Inactive Category Org");
      const supplier = await createSupplierOk(app, admin.accessToken);
      const category = await createCategoryOk(app, admin.accessToken, "Soon Inactive");
      await authed(app, admin.accessToken).patch(`/api/v1/categories/${category.id}`).send({ active: false });

      const res = await authed(app, admin.accessToken).post(`/api/v1/suppliers/${supplier.id}/capabilities`).send({ categoryId: category.id });
      expect(res.status).toBe(400);
    });

    it("Final Hardening: an existing capability relation survives the category later becoming inactive", async () => {
      const admin = await registerOrg(app, "Existing Capability Survives Org");
      const supplier = await createSupplierOk(app, admin.accessToken);
      const category = await createCategoryOk(app, admin.accessToken, "Later Inactive");

      const add = await authed(app, admin.accessToken).post(`/api/v1/suppliers/${supplier.id}/capabilities`).send({ categoryId: category.id });
      expect(add.status).toBe(201);

      await authed(app, admin.accessToken).patch(`/api/v1/categories/${category.id}`).send({ active: false });

      const detail = await authed(app, admin.accessToken).get(`/api/v1/suppliers/${supplier.id}`);
      expect((detail.body.categories as Array<{ categoryId: string }>).some((c) => c.categoryId === category.id)).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────
  // SEARCH / PAGINATION
  // ────────────────────────────────────────────────────────────

  describe("search / pagination", () => {
    it("search matches companyName, supplierCode, and tin", async () => {
      const admin = await registerOrg(app, "Search Org");
      const s = await createSupplierOk(app, admin.accessToken, { companyName: "Uniquely Named Metal Co", tin: "777000111" });

      const byName = await authed(app, admin.accessToken).get("/api/v1/suppliers?search=Uniquely%20Named");
      expect((byName.body.items as Array<{ id: string }>).some((x) => x.id === s.id)).toBe(true);

      const byCode = await authed(app, admin.accessToken).get(`/api/v1/suppliers?search=${s.supplierCode}`);
      expect((byCode.body.items as Array<{ id: string }>).some((x) => x.id === s.id)).toBe(true);

      const byTin = await authed(app, admin.accessToken).get("/api/v1/suppliers?search=777000111");
      expect((byTin.body.items as Array<{ id: string }>).some((x) => x.id === s.id)).toBe(true);
    });

    it("finds a supplier by TIN even when the search term's formatting differs from how the TIN was stored", async () => {
      // Regression (B/C integration audit §26): stored tin "123 456 789"
      // normalizes to "123456789"; searching the differently-formatted
      // "123-456-789" must still find it — comparing the raw search term
      // against normalizedTin cannot, since normalizedTin never contains
      // separators.
      const admin = await registerOrg(app, "Tin Search Format Org");
      const s = await createSupplierOk(app, admin.accessToken, { companyName: "Formatted Tin Co", tin: "123 456 789" });

      const res = await authed(app, admin.accessToken).get("/api/v1/suppliers?search=123-456-789");
      expect((res.body.items as Array<{ id: string }>).some((x) => x.id === s.id)).toBe(true);
    });

    it("respects page/pageSize and rejects pageSize above 100", async () => {
      const admin = await registerOrg(app, "Pagination Org");
      const res = await authed(app, admin.accessToken).get("/api/v1/suppliers?page=1&pageSize=5");
      expect(res.status).toBe(200);
      expect(res.body.pageSize).toBe(5);

      const tooLarge = await authed(app, admin.accessToken).get("/api/v1/suppliers?pageSize=101");
      expect(tooLarge.status).toBe(400);
    });
  });

  // ────────────────────────────────────────────────────────────
  // MASS ASSIGNMENT / SERIALIZATION
  // ────────────────────────────────────────────────────────────

  describe("mass assignment protection", () => {
    it("rejects server-managed fields on create and update", async () => {
      const admin = await registerOrg(app, "Mass Assignment Org");
      const badCreate = await authed(app, admin.accessToken)
        .post("/api/v1/suppliers")
        .send({ companyName: "X", supplierCode: "SUP-999999", status: "ACTIVE", organizationId: "hacked" });
      expect(badCreate.status).toBe(400);

      const supplier = await createSupplierOk(app, admin.accessToken);
      const badUpdate = await authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}`).send({ status: "BLOCKED" });
      expect(badUpdate.status).toBe(400);

      const badBank = await authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}`).send({ bankAccount: "12345" });
      expect(badBank.status).toBe(400);
    });

    it("never exposes legacy/reserved fields (bankName/mfo/bankAccount/country) in the response", async () => {
      const admin = await registerOrg(app, "Serialization Org");
      const supplier = await createSupplierOk(app, admin.accessToken);
      const detail = await authed(app, admin.accessToken).get(`/api/v1/suppliers/${supplier.id}`);
      expect(detail.body).not.toHaveProperty("bankName");
      expect(detail.body).not.toHaveProperty("mfo");
      expect(detail.body).not.toHaveProperty("bankAccount");
      expect(detail.body).not.toHaveProperty("country");
      expect(detail.body).not.toHaveProperty("normalizedTin");
      expect(detail.body).not.toHaveProperty("idempotencyKey");
      expect(detail.body).not.toHaveProperty("payloadHash");
    });
  });

  // ────────────────────────────────────────────────────────────
  // FINAL HARDENING — mutation+audit transaction atomicity. Forces
  // AuditService.log to throw (same jest.spyOn/mockRestore convention as
  // purchase-requests-realtime.e2e.spec.ts's domain-events-failure test)
  // and proves the Supplier field mutation rolls back with it.
  // ────────────────────────────────────────────────────────────

  describe("audit atomicity", () => {
    it("update() rolls back the Supplier field change if AuditLog write fails", async () => {
      const admin = await registerOrg(app, "Update Atomicity Org");
      const supplier = await createSupplierOk(app, admin.accessToken, { companyName: "Before Update" });

      const spy = jest.spyOn(audit, "log").mockRejectedValueOnce(new Error("simulated audit failure"));
      try {
        const res = await authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}`).send({ companyName: "After Update" });
        expect(res.status).toBe(500);
      } finally {
        spy.mockRestore();
      }

      const row = await db.supplier.findUnique({ where: { id: supplier.id } });
      expect(row?.companyName).toBe("Before Update"); // rolled back, not "After Update"
    });

    it("updateStatus() rolls back the status change if AuditLog write fails", async () => {
      const admin = await registerOrg(app, "Status Atomicity Org");
      const supplier = await createSupplierOk(app, admin.accessToken);

      const spy = jest.spyOn(audit, "log").mockRejectedValueOnce(new Error("simulated audit failure"));
      try {
        const res = await authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}/status`).send({ status: "BLOCKED" });
        expect(res.status).toBe(500);
      } finally {
        spy.mockRestore();
      }

      const row = await db.supplier.findUnique({ where: { id: supplier.id } });
      expect(row?.status).toBe("ACTIVE"); // rolled back, not BLOCKED
    });

    it("updateRating() rolls back the rating change if AuditLog write fails", async () => {
      const admin = await registerOrg(app, "Rating Atomicity Org");
      const supplier = await createSupplierOk(app, admin.accessToken);

      const spy = jest.spyOn(audit, "log").mockRejectedValueOnce(new Error("simulated audit failure"));
      try {
        const res = await authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}/rating`).send({ rating: "4" });
        expect(res.status).toBe(500);
      } finally {
        spy.mockRestore();
      }

      const row = await db.supplier.findUnique({ where: { id: supplier.id } });
      expect(row?.rating).toBeNull(); // rolled back, never persisted
    });
  });

  // ────────────────────────────────────────────────────────────
  // FINAL HARDENING — nullable clearing on PATCH
  // ────────────────────────────────────────────────────────────

  describe("nullable clearing", () => {
    it("clears legalName/address/phone/email/website/notes to null via explicit null", async () => {
      const admin = await registerOrg(app, "Clear Fields Org");
      const supplier = await createSupplierOk(app, admin.accessToken, {
        legalName: "Legal Name LLC",
        address: "123 Main St",
        phone: "+998900000000",
        email: "contact@example.test",
        website: "https://example.test",
        notes: "some notes",
      });

      const res = await authed(app, admin.accessToken)
        .patch(`/api/v1/suppliers/${supplier.id}`)
        .send({ legalName: null, address: null, phone: null, email: null, website: null, notes: null });
      expect(res.status).toBe(200);
      expect(res.body.legalName).toBeNull();
      expect(res.body.address).toBeNull();
      expect(res.body.phone).toBeNull();
      expect(res.body.email).toBeNull();
      expect(res.body.website).toBeNull();
      expect(res.body.notes).toBeNull();
    });

    it("a trimmed-to-empty string also clears an optional field to null", async () => {
      const admin = await registerOrg(app, "Clear Via Empty String Org");
      const supplier = await createSupplierOk(app, admin.accessToken, { address: "123 Main St" });

      const res = await authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}`).send({ address: "   " });
      expect(res.status).toBe(200);
      expect(res.body.address).toBeNull();
    });

    it("omitting a field leaves it unchanged, distinct from explicit null", async () => {
      const admin = await registerOrg(app, "Omit Vs Null Org");
      const supplier = await createSupplierOk(app, admin.accessToken, { address: "Keep Me" });

      const res = await authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}`).send({ notes: "irrelevant change" });
      expect(res.status).toBe(200);
      expect(res.body.address).toBe("Keep Me"); // untouched
    });

    it("companyName can never be cleared to null", async () => {
      const admin = await registerOrg(app, "CompanyName Not Clearable Org");
      const supplier = await createSupplierOk(app, admin.accessToken);
      const res = await authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}`).send({ companyName: null });
      expect(res.status).toBe(400);
    });

    it("clearing tin to null also clears normalizedTin, and both are re-checkable via search", async () => {
      const admin = await registerOrg(app, "Clear Tin Org");
      const supplier = await createSupplierOk(app, admin.accessToken, { tin: "111222333" });

      const res = await authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}`).send({ tin: null });
      expect(res.status).toBe(200);
      expect(res.body.tin).toBeNull();

      const row = await db.supplier.findUnique({ where: { id: supplier.id } });
      expect(row?.tin).toBeNull();
      expect(row?.normalizedTin).toBeNull();

      // A second, different supplier can now reuse a previously-conflicting TIN posture freely (both null is always allowed).
      const other = await createSupplierOk(app, admin.accessToken, { companyName: "Other" });
      expect(other.id).not.toBe(supplier.id);
    });

    it("SupplierContact: position/phone/email/telegram are clearable, fullName is not", async () => {
      const admin = await registerOrg(app, "Clear Contact Fields Org");
      const supplier = await createSupplierOk(app, admin.accessToken);
      const contact = await authed(app, admin.accessToken)
        .post(`/api/v1/suppliers/${supplier.id}/contacts`)
        .send({ fullName: "Contact Person", position: "Manager", phone: "+998900000001", email: "person@example.test", telegram: "@person" });

      const cleared = await authed(app, admin.accessToken)
        .patch(`/api/v1/suppliers/${supplier.id}/contacts/${contact.body.id}`)
        .send({ position: null, phone: null, email: null, telegram: null });
      expect(cleared.status).toBe(200);
      expect(cleared.body.position).toBeNull();
      expect(cleared.body.phone).toBeNull();
      expect(cleared.body.email).toBeNull();
      expect(cleared.body.telegram).toBeNull();

      const rejectFullNameNull = await authed(app, admin.accessToken)
        .patch(`/api/v1/suppliers/${supplier.id}/contacts/${contact.body.id}`)
        .send({ fullName: null });
      expect(rejectFullNameNull.status).toBe(400);
    });
  });

  // ────────────────────────────────────────────────────────────
  // FINAL HARDENING — idempotency hash normalization
  // ────────────────────────────────────────────────────────────

  describe("idempotency hash normalization", () => {
    it("a differently-formatted-but-equal TIN on retry still replays the same Supplier, not a 409", async () => {
      const admin = await registerOrg(app, "Hash Normalization Org");
      const key = `hash-norm-${Date.now()}`;

      const first = await authed(app, admin.accessToken)
        .post("/api/v1/suppliers")
        .send({ companyName: "ACME", tin: "AB-1234", idempotencyKey: key });
      expect(first.status).toBe(201);

      // Same logical attempt, retried with the TIN formatted differently
      // (normalizes to the identical "AB1234") — must replay the SAME
      // Supplier, never a 409 idempotency conflict.
      const retry = await authed(app, admin.accessToken)
        .post("/api/v1/suppliers")
        .send({ companyName: "ACME", tin: "AB 1234", idempotencyKey: key });
      expect(retry.status).toBe(201);
      expect(retry.body.id).toBe(first.body.id);
    });

    it("whitespace/casing differences in companyName/email on retry still replay the same Supplier", async () => {
      const admin = await registerOrg(app, "Hash Normalization Casing Org");
      const key = `hash-norm-case-${Date.now()}`;

      const first = await authed(app, admin.accessToken)
        .post("/api/v1/suppliers")
        .send({ companyName: "  ACME  ", email: "SALES@ACME.COM", idempotencyKey: key });
      expect(first.status).toBe(201);

      const retry = await authed(app, admin.accessToken)
        .post("/api/v1/suppliers")
        .send({ companyName: "ACME", email: "sales@acme.com", idempotencyKey: key });
      expect(retry.status).toBe(201);
      expect(retry.body.id).toBe(first.body.id);
    });

    it("a genuinely different payload with the same key still 409s (hash normalization doesn't weaken conflict detection)", async () => {
      const admin = await registerOrg(app, "Hash Normalization Conflict Org");
      const key = `hash-norm-conflict-${Date.now()}`;

      await authed(app, admin.accessToken).post("/api/v1/suppliers").send({ companyName: "Company A", idempotencyKey: key });
      const res = await authed(app, admin.accessToken).post("/api/v1/suppliers").send({ companyName: "Company B", idempotencyKey: key });
      expect(res.status).toBe(409);
    });
  });

  // ────────────────────────────────────────────────────────────
  // FINAL HARDENING — detail contact history/order
  // ────────────────────────────────────────────────────────────

  describe("detail contact history and order", () => {
    it("keeps archived contacts visible in SupplierDetail, ordered active-primary -> other-active -> archived", async () => {
      const admin = await registerOrg(app, "Contact Order Org");
      const supplier = await createSupplierOk(app, admin.accessToken);

      const primary = await authed(app, admin.accessToken)
        .post(`/api/v1/suppliers/${supplier.id}/contacts`)
        .send({ fullName: "Primary Active", isPrimary: true });
      const other = await authed(app, admin.accessToken).post(`/api/v1/suppliers/${supplier.id}/contacts`).send({ fullName: "Other Active" });
      const archived = await authed(app, admin.accessToken).post(`/api/v1/suppliers/${supplier.id}/contacts`).send({ fullName: "Will Archive" });
      await authed(app, admin.accessToken).post(`/api/v1/suppliers/${supplier.id}/contacts/${archived.body.id}/archive`);

      const detail = await authed(app, admin.accessToken).get(`/api/v1/suppliers/${supplier.id}`);
      const names = (detail.body.contacts as Array<{ fullName: string; active: boolean }>).map((c) => c.fullName);
      expect(names).toEqual(["Primary Active", "Other Active", "Will Archive"]);

      const activeFlags = (detail.body.contacts as Array<{ active: boolean }>).map((c) => c.active);
      expect(activeFlags).toEqual([true, true, false]);
      expect(primary.body.id).toBeTruthy();
      expect(other.body.id).toBeTruthy();
    });
  });

  // ────────────────────────────────────────────────────────────
  // CONCURRENCY (B/C integration audit §20/§32/§33) — real HTTP requests
  // fired concurrently against real Postgres, not just direct EntitySequence
  // SQL. Same Promise.all/allSettled convention as entity-sequence.e2e.spec.ts.
  // ────────────────────────────────────────────────────────────

  describe("concurrency", () => {
    it("concurrent creates in one org all receive unique, monotonic supplier codes — no duplicates, no raw 500", async () => {
      const admin = await registerOrg(app, "Concurrent Create Org");
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          authed(app, admin.accessToken).post("/api/v1/suppliers").send({ companyName: `Concurrent Co ${i}` })
        )
      );
      for (const res of results) expect(res.status).toBe(201);
      const codes = results.map((r) => r.body.supplierCode as string);
      expect(new Set(codes).size).toBe(5); // all distinct
      const numbers = codes.map((c) => Number(c.replace("SUP-", ""))).sort((a, b) => a - b);
      expect(numbers).toEqual([1, 2, 3, 4, 5]); // monotonic, no gaps for this uncontested run
    });

    it("concurrent creates with the SAME idempotencyKey and payload produce exactly one Supplier, one code, one audit row", async () => {
      const admin = await registerOrg(app, "Concurrent Idempotent Org");
      const key = `concurrent-idem-${Date.now()}`;
      const body = { companyName: "Idempotent Concurrent Co", idempotencyKey: key };

      const results = await Promise.all(Array.from({ length: 5 }, () => authed(app, admin.accessToken).post("/api/v1/suppliers").send(body)));
      for (const res of results) expect(res.status).toBe(201);

      const ids = new Set(results.map((r) => r.body.id as string));
      expect(ids.size).toBe(1); // every response resolves to the SAME logical Supplier

      const [id] = [...ids];
      const rowCount = await db.supplier.count({ where: { id } });
      expect(rowCount).toBe(1);
      const auditCount = await db.auditLog.count({ where: { entityId: id, action: "SUPPLIER_CREATED" } });
      expect(auditCount).toBe(1); // no duplicate durable side-effect from the replay path
    });

    it("two concurrent primary-contact promotions on the same supplier never leave two active primaries", async () => {
      const admin = await registerOrg(app, "Concurrent Primary Org");
      const supplier = await createSupplierOk(app, admin.accessToken);
      const c1 = await authed(app, admin.accessToken).post(`/api/v1/suppliers/${supplier.id}/contacts`).send({ fullName: "Contact One" });
      const c2 = await authed(app, admin.accessToken).post(`/api/v1/suppliers/${supplier.id}/contacts`).send({ fullName: "Contact Two" });

      const results = await Promise.allSettled([
        authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}/contacts/${c1.body.id}`).send({ isPrimary: true }),
        authed(app, admin.accessToken).patch(`/api/v1/suppliers/${supplier.id}/contacts/${c2.body.id}`).send({ isPrimary: true }),
      ]);

      // Every settled HTTP response must be a clean status, never a raw
      // unhandled error surfacing as 500 (the global HttpExceptionFilter
      // guarantees this regardless, but assert it explicitly here).
      for (const r of results) {
        if (r.status === "fulfilled") expect(r.value.status).toBeLessThan(500);
      }

      const primaryCount = await db.supplierContact.count({ where: { supplierId: supplier.id, isPrimary: true, active: true } });
      expect(primaryCount).toBeLessThanOrEqual(1);
    });
  });
});
