import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, uniqueEmail } from "./test-app";

/** M3.1 Phase D — list/detail read-side and role/ownership visibility. */

interface OrgContext {
  email: string;
  accessToken: string;
  userId: string;
  organizationId: string;
}

async function registerOrg(app: INestApplication, orgName: string): Promise<OrgContext> {
  const email = uniqueEmail("prread");
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
  };
}

async function postPROk(app: INestApplication, token: string, body: Record<string, unknown>) {
  const res = await authed(app, token).post("/api/v1/purchase-requests").send(body);
  if (res.status !== 201) throw new Error(`postPR failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string; requestNumber: string };
}

function listPRs(app: INestApplication, token: string, query: Record<string, string> = {}) {
  const qs = new URLSearchParams(query).toString();
  return authed(app, token).get(`/api/v1/purchase-requests${qs ? `?${qs}` : ""}`);
}

function getPR(app: INestApplication, token: string, id: string) {
  return authed(app, token).get(`/api/v1/purchase-requests/${id}`);
}

const freeTextItem = { itemName: "Industrial gloves", quantity: "100.000", uomCode: "PCS" };

describe("M3.1 Phase D — Purchase Request list / detail / visibility", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // ────────────────────────────────────────────────────────────
  // 53-61. List shape / filters
  // ────────────────────────────────────────────────────────────
  describe("list shape and filters", () => {
    it("53/54. pagination and deterministic newest-first ordering", async () => {
      const admin = await registerOrg(app, "PR ListPaging Co");
      const created = [];
      for (let i = 0; i < 5; i++) created.push(await postPROk(app, admin.accessToken, { items: [freeTextItem] }));

      const page1 = await listPRs(app, admin.accessToken, { page: "1", pageSize: "2" });
      const page2 = await listPRs(app, admin.accessToken, { page: "2", pageSize: "2" });
      const page3 = await listPRs(app, admin.accessToken, { page: "3", pageSize: "2" });
      expect(page1.body.total).toBe(5);
      expect(page1.body.items).toHaveLength(2);
      expect(page2.body.items).toHaveLength(2);
      expect(page3.body.items).toHaveLength(1);

      const allIds = [...page1.body.items, ...page2.body.items, ...page3.body.items].map((p: { id: string }) => p.id);
      expect(new Set(allIds).size).toBe(5);
      // Newest first: the last-created PR appears before the first-created one.
      const idsInOrder = allIds;
      expect(idsInOrder.indexOf(created[4]!.id)).toBeLessThan(idsInOrder.indexOf(created[0]!.id));
    });

    it("55. list items carry itemCount, never a loaded items[] array", async () => {
      const admin = await registerOrg(app, "PR ListItemCount Co");
      await postPROk(app, admin.accessToken, { items: [freeTextItem, freeTextItem] });
      const res = await listPRs(app, admin.accessToken);
      expect(res.body.items[0].itemCount).toBe(2);
      expect(res.body.items[0].items).toBeUndefined();
    });

    it("56. status filter", async () => {
      const admin = await registerOrg(app, "PR ListStatus Co");
      await postPROk(app, admin.accessToken, { items: [freeTextItem] });
      const draftOnly = await listPRs(app, admin.accessToken, { status: "DRAFT" });
      expect(draftOnly.body.total).toBeGreaterThanOrEqual(1);
      const approvedOnly = await listPRs(app, admin.accessToken, { status: "APPROVED" });
      expect(approvedOnly.body.total).toBe(0); // no PR can be APPROVED yet in Phase D
    });

    it("57. requesterUserId filter — positive match, and never overridable to leak a foreign employee's PRs", async () => {
      const admin = await registerOrg(app, "PR ListRequesterFilter Co");
      const employeeA = await inviteAndLogin(app, admin, "EMPLOYEE");
      const employeeB = await inviteAndLogin(app, admin, "EMPLOYEE");
      const prA = await postPROk(app, employeeA.accessToken, { items: [freeTextItem] });
      await postPROk(app, employeeB.accessToken, { items: [freeTextItem] });

      const asAdmin = await listPRs(app, admin.accessToken, { requesterUserId: employeeA.userId });
      expect(asAdmin.body.items.map((p: { id: string }) => p.id)).toEqual([prA.id]);

      // Security: employeeA filtering by employeeB's id must never surface
      // employeeB's PRs — the ownership scope and the query filter combine
      // with AND, not an overridable flat merge.
      const asEmployeeA = await listPRs(app, employeeA.accessToken, { requesterUserId: employeeB.userId });
      expect(asEmployeeA.body.items).toHaveLength(0);
      expect(asEmployeeA.body.total).toBe(0);
    });

    it("58. assignedBuyerUserId filter mechanism (always empty in Phase D — no assign endpoint exists yet)", async () => {
      const admin = await registerOrg(app, "PR ListAssignedFilter Co");
      await postPROk(app, admin.accessToken, { items: [freeTextItem] });
      const res = await listPRs(app, admin.accessToken, { assignedBuyerUserId: "11111111-1111-1111-1111-111111111111" });
      expect(res.body.total).toBe(0);
    });

    it("59. priority filter", async () => {
      const admin = await registerOrg(app, "PR ListPriorityFilter Co");
      await postPROk(app, admin.accessToken, { items: [freeTextItem], priority: "URGENT" });
      await postPROk(app, admin.accessToken, { items: [freeTextItem], priority: "LOW" });
      const urgentOnly = await listPRs(app, admin.accessToken, { priority: "URGENT" });
      expect(urgentOnly.body.items.every((p: { priority: string }) => p.priority === "URGENT")).toBe(true);
      expect(urgentOnly.body.total).toBe(1);
    });

    it("60. requestNumber exact filter", async () => {
      const admin = await registerOrg(app, "PR ListRequestNumberFilter Co");
      const pr = await postPROk(app, admin.accessToken, { items: [freeTextItem] });
      const res = await listPRs(app, admin.accessToken, { requestNumber: pr.requestNumber });
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].id).toBe(pr.id);
    });

    it("61. createdAtFrom/createdAtTo date filters", async () => {
      const admin = await registerOrg(app, "PR ListDateFilter Co");
      const before = await postPROk(app, admin.accessToken, { items: [freeTextItem] });
      await new Promise((r) => setTimeout(r, 20));
      const cutoff = new Date().toISOString();
      await new Promise((r) => setTimeout(r, 20));
      const after = await postPROk(app, admin.accessToken, { items: [freeTextItem] });

      const fromCutoff = await listPRs(app, admin.accessToken, { createdAtFrom: cutoff });
      const idsFrom = fromCutoff.body.items.map((p: { id: string }) => p.id);
      expect(idsFrom).toContain(after.id);
      expect(idsFrom).not.toContain(before.id);

      const toCutoff = await listPRs(app, admin.accessToken, { createdAtTo: cutoff });
      const idsTo = toCutoff.body.items.map((p: { id: string }) => p.id);
      expect(idsTo).toContain(before.id);
      expect(idsTo).not.toContain(after.id);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 62-70. Visibility / RBAC / tenant isolation
  // ────────────────────────────────────────────────────────────
  describe("visibility and isolation", () => {
    it("62/63. EMPLOYEE list/total contain only their own PRs", async () => {
      const admin = await registerOrg(app, "PR VisEmployee Co");
      const employeeA = await inviteAndLogin(app, admin, "EMPLOYEE");
      const employeeB = await inviteAndLogin(app, admin, "EMPLOYEE");
      const prA = await postPROk(app, employeeA.accessToken, { items: [freeTextItem] });
      await postPROk(app, employeeB.accessToken, { items: [freeTextItem] });
      await postPROk(app, admin.accessToken, { items: [freeTextItem] });

      const res = await listPRs(app, employeeA.accessToken);
      expect(res.body.total).toBe(1);
      expect(res.body.items.map((p: { id: string }) => p.id)).toEqual([prA.id]);
    });

    it("64. EMPLOYEE cannot read another user's PR by id", async () => {
      const admin = await registerOrg(app, "PR VisEmployeeDetail Co");
      const employeeA = await inviteAndLogin(app, admin, "EMPLOYEE");
      const employeeB = await inviteAndLogin(app, admin, "EMPLOYEE");
      const prA = await postPROk(app, employeeA.accessToken, { items: [freeTextItem] });
      const res = await getPR(app, employeeB.accessToken, prA.id);
      expect(res.status).toBe(404);
    });

    it("65. procurement roles read all organization PRs", async () => {
      const admin = await registerOrg(app, "PR VisProcRole Co");
      const employee = await inviteAndLogin(app, admin, "EMPLOYEE");
      const specialist = await inviteAndLogin(app, admin, "PROCUREMENT_SPECIALIST");
      const pr = await postPROk(app, employee.accessToken, { items: [freeTextItem] });

      const listRes = await listPRs(app, specialist.accessToken);
      expect(listRes.body.items.map((p: { id: string }) => p.id)).toContain(pr.id);
      const detailRes = await getPR(app, specialist.accessToken, pr.id);
      expect(detailRes.status).toBe(200);
    });

    it("66/67/68. APPROVER sees only assigned-approval PRs — always zero in Phase D, total obeys it, detail rejects an unassigned PR", async () => {
      const admin = await registerOrg(app, "PR VisApprover Co");
      const approver = await inviteAndLogin(app, admin, "APPROVER");
      const pr = await postPROk(app, admin.accessToken, { items: [freeTextItem] });

      const listRes = await listPRs(app, approver.accessToken);
      expect(listRes.body.items).toHaveLength(0);
      expect(listRes.body.total).toBe(0);

      const detailRes = await getPR(app, approver.accessToken, pr.id);
      expect(detailRes.status).toBe(404); // exists, but not assigned to this approver — no leak
    });

    it("69. SUPPLIER denied list and detail", async () => {
      const admin = await registerOrg(app, "PR VisSupplierDeny Co");
      const supplier = await inviteAndLogin(app, admin, "SUPPLIER");
      const pr = await postPROk(app, admin.accessToken, { items: [freeTextItem] });

      expect((await listPRs(app, supplier.accessToken)).status).toBe(403);
      expect((await getPR(app, supplier.accessToken, pr.id)).status).toBe(403);
    });

    it("70. cross-tenant list/detail isolation", async () => {
      const orgA = await registerOrg(app, "PR VisTenantA Co");
      const orgB = await registerOrg(app, "PR VisTenantB Co");
      const prA = await postPROk(app, orgA.accessToken, { items: [freeTextItem] });
      const prB = await postPROk(app, orgB.accessToken, { items: [freeTextItem] });

      const listAsA = await listPRs(app, orgA.accessToken);
      const idsA = listAsA.body.items.map((p: { id: string }) => p.id);
      expect(idsA).toContain(prA.id);
      expect(idsA).not.toContain(prB.id);

      const detailCrossTenant = await getPR(app, orgA.accessToken, prB.id);
      expect(detailCrossTenant.status).toBe(404);
    });
  });
});
