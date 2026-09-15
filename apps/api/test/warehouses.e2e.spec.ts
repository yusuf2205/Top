import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, uniqueEmail } from "./test-app";

interface OrgContext {
  email: string;
  accessToken: string;
  userId: string;
}

async function registerOrg(app: INestApplication, orgName: string): Promise<OrgContext> {
  const email = uniqueEmail("wh");
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

async function createWarehouse(
  app: INestApplication,
  token: string,
  overrides: Record<string, unknown> = {}
): Promise<{ id: string; code: string }> {
  const res = await authed(app, token)
    .post("/api/v1/warehouses")
    .send({ code: `WH-${Math.random().toString(36).slice(2, 8).toUpperCase()}`, name: "Test Warehouse", ...overrides });
  return { id: res.body.id as string, code: res.body.code as string };
}

async function createLocation(
  app: INestApplication,
  token: string,
  warehouseId: string,
  overrides: Record<string, unknown> = {}
): Promise<{ id: string; code: string }> {
  const res = await authed(app, token)
    .post(`/api/v1/warehouses/${warehouseId}/locations`)
    .send({ code: `LOC-${Math.random().toString(36).slice(2, 8).toUpperCase()}`, name: "Test Location", ...overrides });
  return { id: res.body.id as string, code: res.body.code as string };
}

describe("M2.4-A Warehouse + Location", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("Warehouse CRUD", () => {
    it("creates a warehouse", async () => {
      const admin = await registerOrg(app, "Warehouse Create Co");
      const res = await authed(app, admin.accessToken).post("/api/v1/warehouses").send({ code: "MAIN", name: "Main Warehouse" });
      expect(res.status).toBe(201);
      expect(res.body.code).toBe("MAIN");
      expect(res.body.active).toBe(true);
    });

    it("lists and reads a single warehouse", async () => {
      const admin = await registerOrg(app, "Warehouse Read Co");
      const wh = await createWarehouse(app, admin.accessToken);

      const list = await authed(app, admin.accessToken).get("/api/v1/warehouses");
      expect(list.status).toBe(200);
      expect(list.body.some((w: { id: string }) => w.id === wh.id)).toBe(true);

      const get = await authed(app, admin.accessToken).get(`/api/v1/warehouses/${wh.id}`);
      expect(get.status).toBe(200);
      expect(get.body.id).toBe(wh.id);
    });

    it("updates a warehouse", async () => {
      const admin = await registerOrg(app, "Warehouse Update Co");
      const wh = await createWarehouse(app, admin.accessToken);
      const res = await authed(app, admin.accessToken).patch(`/api/v1/warehouses/${wh.id}`).send({ name: "Renamed" });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Renamed");
    });

    it("rejects a duplicate warehouse code within the same organization (409)", async () => {
      const admin = await registerOrg(app, "Warehouse Duplicate Co");
      await authed(app, admin.accessToken).post("/api/v1/warehouses").send({ code: "MAIN", name: "First" });
      const res = await authed(app, admin.accessToken).post("/api/v1/warehouses").send({ code: "main", name: "Second" });
      expect(res.status).toBe(409);
    });

    it("allows the same warehouse code in two different organizations", async () => {
      const orgA = await registerOrg(app, "Warehouse Same Code A");
      const orgB = await registerOrg(app, "Warehouse Same Code B");
      const a = await authed(app, orgA.accessToken).post("/api/v1/warehouses").send({ code: "MAIN", name: "A" });
      const b = await authed(app, orgB.accessToken).post("/api/v1/warehouses").send({ code: "MAIN", name: "B" });
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
    });

    it("inactive warehouse: PATCH active:false persists and the warehouse remains readable", async () => {
      const admin = await registerOrg(app, "Warehouse Inactive Co");
      const wh = await createWarehouse(app, admin.accessToken);
      const patch = await authed(app, admin.accessToken).patch(`/api/v1/warehouses/${wh.id}`).send({ active: false });
      expect(patch.status).toBe(200);
      expect(patch.body.active).toBe(false);

      const get = await authed(app, admin.accessToken).get(`/api/v1/warehouses/${wh.id}`);
      expect(get.status).toBe(200);
      expect(get.body.active).toBe(false);
    });

    it("mass assignment: organizationId/organization in the body are ignored", async () => {
      const admin = await registerOrg(app, "Warehouse Mass Assign Co");
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/warehouses")
        .send({ code: "MAIN", name: "Main", organizationId: "not-a-real-org", organization: { id: "hack" } });
      expect(res.status).toBe(201);
      expect(res.body.organizationId).toBeUndefined();
    });

    it("GET on a nonexistent warehouse id returns 404", async () => {
      const admin = await registerOrg(app, "Warehouse Invalid Id Co");
      const res = await authed(app, admin.accessToken).get("/api/v1/warehouses/00000000-0000-0000-0000-000000000000");
      expect(res.status).toBe(404);
    });
  });

  describe("Location CRUD", () => {
    it("creates a location under a warehouse", async () => {
      const admin = await registerOrg(app, "Location Create Co");
      const wh = await createWarehouse(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .post(`/api/v1/warehouses/${wh.id}/locations`)
        .send({ code: "A-01", name: "Aisle 1" });
      expect(res.status).toBe(201);
      expect(res.body.code).toBe("A-01");
      expect(res.body.warehouseId).toBe(wh.id);
    });

    it("lists locations scoped to their warehouse", async () => {
      const admin = await registerOrg(app, "Location List Co");
      const whA = await createWarehouse(app, admin.accessToken);
      const whB = await createWarehouse(app, admin.accessToken);
      const locA = await createLocation(app, admin.accessToken, whA.id);
      await createLocation(app, admin.accessToken, whB.id);

      const list = await authed(app, admin.accessToken).get(`/api/v1/warehouses/${whA.id}/locations`);
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0].id).toBe(locA.id);
    });

    it("updates a location", async () => {
      const admin = await registerOrg(app, "Location Update Co");
      const wh = await createWarehouse(app, admin.accessToken);
      const loc = await createLocation(app, admin.accessToken, wh.id);
      const res = await authed(app, admin.accessToken)
        .patch(`/api/v1/warehouses/${wh.id}/locations/${loc.id}`)
        .send({ name: "Renamed Location" });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Renamed Location");
    });

    it("rejects a duplicate location code within the same warehouse (409)", async () => {
      const admin = await registerOrg(app, "Location Duplicate Co");
      const wh = await createWarehouse(app, admin.accessToken);
      await authed(app, admin.accessToken).post(`/api/v1/warehouses/${wh.id}/locations`).send({ code: "A-01", name: "First" });
      const res = await authed(app, admin.accessToken)
        .post(`/api/v1/warehouses/${wh.id}/locations`)
        .send({ code: "a-01", name: "Second" });
      expect(res.status).toBe(409);
    });

    it("allows the same location code in two different warehouses", async () => {
      const admin = await registerOrg(app, "Location Same Code Co");
      const whA = await createWarehouse(app, admin.accessToken);
      const whB = await createWarehouse(app, admin.accessToken);
      const a = await authed(app, admin.accessToken).post(`/api/v1/warehouses/${whA.id}/locations`).send({ code: "A-01", name: "A" });
      const b = await authed(app, admin.accessToken).post(`/api/v1/warehouses/${whB.id}/locations`).send({ code: "A-01", name: "B" });
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
    });

    it("inactive location: PATCH active:false persists", async () => {
      const admin = await registerOrg(app, "Location Inactive Co");
      const wh = await createWarehouse(app, admin.accessToken);
      const loc = await createLocation(app, admin.accessToken, wh.id);
      const res = await authed(app, admin.accessToken)
        .patch(`/api/v1/warehouses/${wh.id}/locations/${loc.id}`)
        .send({ active: false });
      expect(res.status).toBe(200);
      expect(res.body.active).toBe(false);
    });

    it("rejects creating a location under an inactive warehouse", async () => {
      const admin = await registerOrg(app, "Location Under Inactive Wh Co");
      const wh = await createWarehouse(app, admin.accessToken);
      await authed(app, admin.accessToken).patch(`/api/v1/warehouses/${wh.id}`).send({ active: false });
      const res = await authed(app, admin.accessToken)
        .post(`/api/v1/warehouses/${wh.id}/locations`)
        .send({ code: "A-01", name: "Aisle 1" });
      expect(res.status).toBe(400);
    });

    it("mass assignment: warehouseId in the body cannot retarget a location to another warehouse", async () => {
      const admin = await registerOrg(app, "Location Mass Assign Co");
      const whA = await createWarehouse(app, admin.accessToken);
      const whB = await createWarehouse(app, admin.accessToken);
      const res = await authed(app, admin.accessToken)
        .post(`/api/v1/warehouses/${whA.id}/locations`)
        .send({ code: "A-01", name: "A", warehouseId: whB.id, organizationId: "not-a-real-org" });
      expect(res.status).toBe(201);
      expect(res.body.warehouseId).toBe(whA.id);
    });
  });

  describe("Composition check: Location.warehouseId ownership", () => {
    it("404s when creating a location under a nonexistent warehouse id", async () => {
      const admin = await registerOrg(app, "Location No Warehouse Co");
      const res = await authed(app, admin.accessToken)
        .post("/api/v1/warehouses/00000000-0000-0000-0000-000000000000/locations")
        .send({ code: "A-01", name: "Aisle 1" });
      expect(res.status).toBe(404);
    });

    it("404s when updating a location using a mismatched (but real, same-org) warehouseId in the route", async () => {
      const admin = await registerOrg(app, "Location Mismatched Warehouse Co");
      const whA = await createWarehouse(app, admin.accessToken);
      const whB = await createWarehouse(app, admin.accessToken);
      const locA = await createLocation(app, admin.accessToken, whA.id);
      const res = await authed(app, admin.accessToken)
        .patch(`/api/v1/warehouses/${whB.id}/locations/${locA.id}`)
        .send({ name: "Hijacked" });
      expect(res.status).toBe(404);
    });
  });

  describe("Tenant isolation (cross-organization)", () => {
    it("cannot GET another organization's warehouse", async () => {
      const orgA = await registerOrg(app, "Tenant Warehouse A");
      const orgB = await registerOrg(app, "Tenant Warehouse B");
      const wh = await createWarehouse(app, orgA.accessToken);
      const res = await authed(app, orgB.accessToken).get(`/api/v1/warehouses/${wh.id}`);
      expect(res.status).toBe(404);
    });

    it("cannot PATCH another organization's warehouse", async () => {
      const orgA = await registerOrg(app, "Tenant Warehouse Update A");
      const orgB = await registerOrg(app, "Tenant Warehouse Update B");
      const wh = await createWarehouse(app, orgA.accessToken);
      const res = await authed(app, orgB.accessToken).patch(`/api/v1/warehouses/${wh.id}`).send({ name: "Hijacked" });
      expect(res.status).toBe(404);
    });

    it("cannot list another organization's locations (foreign warehouseId)", async () => {
      const orgA = await registerOrg(app, "Tenant Location List A");
      const orgB = await registerOrg(app, "Tenant Location List B");
      const wh = await createWarehouse(app, orgA.accessToken);
      await createLocation(app, orgA.accessToken, wh.id);
      const res = await authed(app, orgB.accessToken).get(`/api/v1/warehouses/${wh.id}/locations`);
      expect(res.status).toBe(404);
    });

    it("cannot create a location under another organization's warehouse (foreign warehouseId)", async () => {
      const orgA = await registerOrg(app, "Tenant Location Create A");
      const orgB = await registerOrg(app, "Tenant Location Create B");
      const wh = await createWarehouse(app, orgA.accessToken);
      const res = await authed(app, orgB.accessToken)
        .post(`/api/v1/warehouses/${wh.id}/locations`)
        .send({ code: "A-01", name: "Aisle 1" });
      expect(res.status).toBe(404);
    });

    it("cannot PATCH another organization's location", async () => {
      const orgA = await registerOrg(app, "Tenant Location Update A");
      const orgB = await registerOrg(app, "Tenant Location Update B");
      const wh = await createWarehouse(app, orgA.accessToken);
      const loc = await createLocation(app, orgA.accessToken, wh.id);
      const res = await authed(app, orgB.accessToken)
        .patch(`/api/v1/warehouses/${wh.id}/locations/${loc.id}`)
        .send({ name: "Hijacked" });
      expect(res.status).toBe(404);
    });
  });

  describe("RBAC", () => {
    it("EMPLOYEE can read but not create a warehouse", async () => {
      const admin = await registerOrg(app, "Warehouse RBAC Employee Co");
      const employee = await inviteAndLogin(app, admin, "EMPLOYEE");
      const read = await authed(app, employee.accessToken).get("/api/v1/warehouses");
      expect(read.status).toBe(200);
      const write = await authed(app, employee.accessToken).post("/api/v1/warehouses").send({ code: "MAIN", name: "Main" });
      expect(write.status).toBe(403);
    });

    it("PROCUREMENT_SPECIALIST cannot create a warehouse (stricter than Product RBAC)", async () => {
      const admin = await registerOrg(app, "Warehouse RBAC Specialist Co");
      const specialist = await inviteAndLogin(app, admin, "PROCUREMENT_SPECIALIST");
      const res = await authed(app, specialist.accessToken).post("/api/v1/warehouses").send({ code: "MAIN", name: "Main" });
      expect(res.status).toBe(403);
    });

    it("PROCUREMENT_MANAGER can create a warehouse and a location", async () => {
      const admin = await registerOrg(app, "Warehouse RBAC Manager Co");
      const manager = await inviteAndLogin(app, admin, "PROCUREMENT_MANAGER");
      const wh = await authed(app, manager.accessToken).post("/api/v1/warehouses").send({ code: "MAIN", name: "Main" });
      expect(wh.status).toBe(201);
      const loc = await authed(app, manager.accessToken)
        .post(`/api/v1/warehouses/${wh.body.id}/locations`)
        .send({ code: "A-01", name: "Aisle 1" });
      expect(loc.status).toBe(201);
    });

    it("APPROVER can read but not write", async () => {
      const admin = await registerOrg(app, "Warehouse RBAC Approver Co");
      const approver = await inviteAndLogin(app, admin, "APPROVER");
      const res = await authed(app, approver.accessToken).post("/api/v1/warehouses").send({ code: "MAIN", name: "Main" });
      expect(res.status).toBe(403);
    });
  });
});
