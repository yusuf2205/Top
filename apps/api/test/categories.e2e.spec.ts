import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, uniqueEmail } from "./test-app";

/**
 * M3.2 (Architecture Gate Revision 1, R16/R20). Minimal Category CRUD —
 * the gap-filler that unblocks Supplier capability tagging. Reuses the
 * pre-existing `Category` model's `active` boolean, no new lifecycle.
 */

interface OrgContext {
  email: string;
  accessToken: string;
  userId: string;
  organizationId: string;
}

async function registerOrg(app: INestApplication, orgName: string): Promise<OrgContext> {
  const email = uniqueEmail("cat");
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
  return { email, accessToken: login.body.accessToken as string, userId: login.body.user.id as string, organizationId: admin.organizationId };
}

function authed(app: INestApplication, token: string) {
  return {
    get: (url: string) => request(app.getHttpServer()).get(url).set("Authorization", `Bearer ${token}`),
    post: (url: string) => request(app.getHttpServer()).post(url).set("Authorization", `Bearer ${token}`),
    patch: (url: string) => request(app.getHttpServer()).patch(url).set("Authorization", `Bearer ${token}`),
  };
}

describe("M3.2 Category CRUD", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates, lists, and updates a category", async () => {
    const admin = await registerOrg(app, "Category Org");
    const created = await authed(app, admin.accessToken).post("/api/v1/categories").send({ name: "Aluminum" });
    expect(created.status).toBe(201);
    expect(created.body.active).toBe(true);

    const list = await authed(app, admin.accessToken).get("/api/v1/categories");
    expect((list.body as Array<{ name: string }>).some((c) => c.name === "Aluminum")).toBe(true);

    const updated = await authed(app, admin.accessToken).patch(`/api/v1/categories/${created.body.id}`).send({ name: "Aluminium", active: false });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe("Aluminium");
    expect(updated.body.active).toBe(false);
  });

  it("excludes inactive categories by default, includes them with includeInactive=true", async () => {
    const admin = await registerOrg(app, "Inactive Category Org");
    const created = await authed(app, admin.accessToken).post("/api/v1/categories").send({ name: "Deprecated Category" });
    await authed(app, admin.accessToken).patch(`/api/v1/categories/${created.body.id}`).send({ active: false });

    const defaultList = await authed(app, admin.accessToken).get("/api/v1/categories");
    expect((defaultList.body as Array<{ id: string }>).some((c) => c.id === created.body.id)).toBe(false);

    const includeInactive = await authed(app, admin.accessToken).get("/api/v1/categories?includeInactive=true");
    expect((includeInactive.body as Array<{ id: string }>).some((c) => c.id === created.body.id)).toBe(true);
  });

  it("rejects a duplicate category name within the same organization", async () => {
    const admin = await registerOrg(app, "Duplicate Category Org");
    await authed(app, admin.accessToken).post("/api/v1/categories").send({ name: "Fasteners" });
    const dup = await authed(app, admin.accessToken).post("/api/v1/categories").send({ name: "Fasteners" });
    expect(dup.status).toBe(409);
  });

  it("PROCUREMENT_SPECIALIST can read but not create/update categories", async () => {
    const admin = await registerOrg(app, "Category RBAC Org");
    const specialist = await inviteAndLogin(app, admin, "PROCUREMENT_SPECIALIST");
    expect((await authed(app, specialist.accessToken).get("/api/v1/categories")).status).toBe(200);
    expect((await authed(app, specialist.accessToken).post("/api/v1/categories").send({ name: "Nope" })).status).toBe(403);
  });

  it("EMPLOYEE cannot read categories", async () => {
    const admin = await registerOrg(app, "Category Employee Org");
    const employee = await inviteAndLogin(app, admin, "EMPLOYEE");
    expect((await authed(app, employee.accessToken).get("/api/v1/categories")).status).toBe(403);
  });

  it("categories are tenant-isolated", async () => {
    const orgA = await registerOrg(app, "Category Tenant A");
    const orgB = await registerOrg(app, "Category Tenant B");
    const created = await authed(app, orgA.accessToken).post("/api/v1/categories").send({ name: "Only In A" });
    const list = await authed(app, orgB.accessToken).get("/api/v1/categories");
    expect((list.body as Array<{ id: string }>).some((c) => c.id === created.body.id)).toBe(false);

    const updateAttempt = await authed(app, orgB.accessToken).patch(`/api/v1/categories/${created.body.id}`).send({ name: "Hijacked" });
    expect(updateAttempt.status).toBe(404);
  });
});
