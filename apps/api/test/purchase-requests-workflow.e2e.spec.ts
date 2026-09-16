import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createSystemPrismaClient } from "@top/database";
import { createTestApp, uniqueEmail } from "./test-app";

/**
 * M3.1 Phase E — submit / approve / reject / cancel / assign workflow,
 * ApprovalInstance/ApprovalStepInstance integration, atomic state
 * transitions, concurrency, and RBAC/ownership/tenant isolation, all over
 * real HTTP against real Postgres.
 */

interface OrgContext {
  email: string;
  accessToken: string;
  userId: string;
  organizationId: string;
}

async function registerOrg(app: INestApplication, orgName: string): Promise<OrgContext> {
  const email = uniqueEmail("prwf");
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

const freeTextItem = { itemName: "Steel pipe DN50", quantity: "20.000", uomCode: "M" };

async function postPROk(app: INestApplication, token: string, body: Record<string, unknown> = { items: [freeTextItem] }) {
  const res = await authed(app, token).post("/api/v1/purchase-requests").send(body);
  if (res.status !== 201) throw new Error(`postPR failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string; requestNumber: string };
}

function getPR(app: INestApplication, token: string, id: string) {
  return authed(app, token).get(`/api/v1/purchase-requests/${id}`);
}
function submitPR(app: INestApplication, token: string, id: string) {
  return authed(app, token).post(`/api/v1/purchase-requests/${id}/submit`);
}
function approvePR(app: INestApplication, token: string, id: string) {
  return authed(app, token).post(`/api/v1/purchase-requests/${id}/approve`);
}
function rejectPR(app: INestApplication, token: string, id: string, reason = "Budget exceeded") {
  return authed(app, token).post(`/api/v1/purchase-requests/${id}/reject`).send({ reason });
}
function cancelPR(app: INestApplication, token: string, id: string) {
  return authed(app, token).post(`/api/v1/purchase-requests/${id}/cancel`);
}
function assignBuyer(app: INestApplication, token: string, id: string, assignedBuyerUserId: string) {
  return authed(app, token).patch(`/api/v1/purchase-requests/${id}/assign`).send({ assignedBuyerUserId });
}

async function submitOk(app: INestApplication, token: string, id: string) {
  const res = await submitPR(app, token, id);
  if (res.status !== 200) throw new Error(`submit failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as Record<string, unknown>;
}

/** ADMIN creates + submits a fresh DRAFT in one call, returning the PR id — the common starting fixture for approve/reject/cancel/assign tests. */
async function createUnderApproval(app: INestApplication, admin: OrgContext): Promise<string> {
  const pr = await postPROk(app, admin.accessToken);
  await submitOk(app, admin.accessToken, pr.id);
  return pr.id;
}

describe("M3.1 Phase E — Purchase Request workflow (submit/approve/reject/cancel/assign)", () => {
  let app: INestApplication;
  let db: ReturnType<typeof createSystemPrismaClient>;

  beforeAll(async () => {
    app = await createTestApp();
    db = createSystemPrismaClient();
  });

  afterAll(async () => {
    await app.close();
  });

  // ────────────────────────────────────────────────────────────
  // 1-20. SUBMIT
  // ────────────────────────────────────────────────────────────
  describe("submit", () => {
    it("1/6. EMPLOYEE submits own DRAFT; ADMIN/MANAGER/SPECIALIST submit org DRAFT; APPROVER/SUPPLIER denied", async () => {
      const admin = await registerOrg(app, "Submit RBAC Co");
      const employee = await inviteAndLogin(app, admin, "EMPLOYEE");
      const manager = await inviteAndLogin(app, admin, "PROCUREMENT_MANAGER");
      const specialist = await inviteAndLogin(app, admin, "PROCUREMENT_SPECIALIST");
      const approver = await inviteAndLogin(app, admin, "APPROVER");
      const supplier = await inviteAndLogin(app, admin, "SUPPLIER");

      const prEmployee = await postPROk(app, employee.accessToken);
      expect((await submitPR(app, employee.accessToken, prEmployee.id)).status).toBe(200);

      const prAdmin = await postPROk(app, admin.accessToken);
      expect((await submitPR(app, admin.accessToken, prAdmin.id)).status).toBe(200);

      const prManager = await postPROk(app, manager.accessToken);
      expect((await submitPR(app, manager.accessToken, prManager.id)).status).toBe(200);

      const prSpecialist = await postPROk(app, specialist.accessToken);
      expect((await submitPR(app, specialist.accessToken, prSpecialist.id)).status).toBe(200);

      const prForApprover = await postPROk(app, admin.accessToken);
      expect((await submitPR(app, approver.accessToken, prForApprover.id)).status).toBe(403);

      const prForSupplier = await postPROk(app, admin.accessToken);
      expect((await submitPR(app, supplier.accessToken, prForSupplier.id)).status).toBe(403);
    });

    it("2. EMPLOYEE cannot submit another user's DRAFT (404, no leak)", async () => {
      const admin = await registerOrg(app, "Submit Foreign Owner Co");
      const employeeA = await inviteAndLogin(app, admin, "EMPLOYEE");
      const employeeB = await inviteAndLogin(app, admin, "EMPLOYEE");
      const pr = await postPROk(app, employeeA.accessToken);
      const res = await submitPR(app, employeeB.accessToken, pr.id);
      expect(res.status).toBe(404);
    });

    it("3. empty DRAFT cannot be submitted — 409, not 400 (payload is valid, state is not)", async () => {
      const admin = await registerOrg(app, "Submit Empty Co");
      const created = await authed(app, admin.accessToken).post("/api/v1/purchase-requests").send({ items: [freeTextItem] });
      const prId = created.body.id as string;
      const itemId = (created.body.items as Array<{ id: string }>)[0]!.id;
      await authed(app, admin.accessToken).delete(`/api/v1/purchase-requests/${prId}/items/${itemId}`);

      const res = await submitPR(app, admin.accessToken, prId);
      expect(res.status).toBe(409);
    });

    it("4. non-DRAFT purchase request cannot be re-submitted — 409", async () => {
      const admin = await registerOrg(app, "Submit NonDraft Co");
      const prId = await createUnderApproval(app, admin);
      const res = await submitPR(app, admin.accessToken, prId);
      expect(res.status).toBe(409);
    });

    it("5. submit sets submittedAt, final status UNDER_APPROVAL, creates exactly one PENDING ApprovalInstance + one PENDING step (stepOrder=1, approverRole=PROCUREMENT_MANAGER, assignedUserId=null), writes a SUBMITTED audit row, and publishes no realtime event", async () => {
      const admin = await registerOrg(app, "Submit Shape Co");
      const pr = await postPROk(app, admin.accessToken);
      const body = await submitOk(app, admin.accessToken, pr.id);

      expect(body.status).toBe("UNDER_APPROVAL");
      expect(body.submittedAt).toBeTruthy();
      const approval = body.approval as Record<string, unknown>;
      expect(approval.status).toBe("PENDING");
      expect(approval.completedAt).toBeNull();
      const step = approval.step as Record<string, unknown>;
      expect(step.stepOrder).toBe(1);
      expect(step.approverRole).toBe("PROCUREMENT_MANAGER");
      expect(step.assignedUserId).toBeNull();
      expect(step.status).toBe("PENDING");

      const instances = await db.approvalInstance.findMany({ where: { purchaseRequestId: pr.id } });
      expect(instances).toHaveLength(1);
      const steps = await db.approvalStepInstance.findMany({ where: { approvalInstanceId: instances[0]!.id } });
      expect(steps).toHaveLength(1);

      const audits = await db.auditLog.findMany({ where: { entityType: "PurchaseRequest", entityId: pr.id, action: "PURCHASE_REQUEST_SUBMITTED" } });
      expect(audits).toHaveLength(1);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 21-28. SUBMIT CONCURRENCY
  // ────────────────────────────────────────────────────────────
  describe("submit concurrency", () => {
    it("two concurrent submit calls: exactly one succeeds, loser 409, exactly one ApprovalInstance/ApprovalStepInstance/SUBMITTED audit, submittedAt stable", async () => {
      const admin = await registerOrg(app, "Submit Race Co");
      const pr = await postPROk(app, admin.accessToken);

      const [r1, r2] = await Promise.all([submitPR(app, admin.accessToken, pr.id), submitPR(app, admin.accessToken, pr.id)]);
      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([200, 409]);

      const instances = await db.approvalInstance.findMany({ where: { purchaseRequestId: pr.id } });
      expect(instances).toHaveLength(1);
      const steps = await db.approvalStepInstance.findMany({ where: { approvalInstanceId: instances[0]!.id } });
      expect(steps).toHaveLength(1);
      const audits = await db.auditLog.findMany({ where: { entityType: "PurchaseRequest", entityId: pr.id, action: "PURCHASE_REQUEST_SUBMITTED" } });
      expect(audits).toHaveLength(1);

      const final = await getPR(app, admin.accessToken, pr.id);
      expect(final.body.status).toBe("UNDER_APPROVAL");
    });
  });

  // ────────────────────────────────────────────────────────────
  // 29-43. APPROVE
  // ────────────────────────────────────────────────────────────
  describe("approve", () => {
    it("ADMIN/MANAGER approve; SPECIALIST/EMPLOYEE/SUPPLIER denied; unassigned APPROVER cannot approve (404, no leak)", async () => {
      const admin = await registerOrg(app, "Approve RBAC Co");
      const specialist = await inviteAndLogin(app, admin, "PROCUREMENT_SPECIALIST");
      const employee = await inviteAndLogin(app, admin, "EMPLOYEE");
      const supplier = await inviteAndLogin(app, admin, "SUPPLIER");
      const approver = await inviteAndLogin(app, admin, "APPROVER");
      const manager = await inviteAndLogin(app, admin, "PROCUREMENT_MANAGER");

      const prAdmin = await createUnderApproval(app, admin);
      expect((await approvePR(app, admin.accessToken, prAdmin)).status).toBe(200);

      const prManager = await createUnderApproval(app, admin);
      expect((await approvePR(app, manager.accessToken, prManager)).status).toBe(200);

      const prSpecialist = await createUnderApproval(app, admin);
      expect((await approvePR(app, specialist.accessToken, prSpecialist)).status).toBe(403);

      const prEmployee = await createUnderApproval(app, admin);
      expect((await approvePR(app, employee.accessToken, prEmployee)).status).toBe(403);

      const prSupplier = await createUnderApproval(app, admin);
      expect((await approvePR(app, supplier.accessToken, prSupplier)).status).toBe(403);

      const prApprover = await createUnderApproval(app, admin);
      expect((await approvePR(app, approver.accessToken, prApprover)).status).toBe(404);
    });

    it("approve transitions PR/instance/step, sets decidedById/decidedAt/completedAt, writes one APPROVED audit; repeated approve -> 409; reject after approve -> 409", async () => {
      const admin = await registerOrg(app, "Approve Shape Co");
      const manager = await inviteAndLogin(app, admin, "PROCUREMENT_MANAGER");
      const prId = await createUnderApproval(app, admin);

      const res = await approvePR(app, manager.accessToken, prId);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("APPROVED");
      const approval = res.body.approval as Record<string, unknown>;
      expect(approval.status).toBe("APPROVED");
      expect(approval.completedAt).toBeTruthy();
      const step = approval.step as Record<string, unknown>;
      expect(step.status).toBe("APPROVED");
      expect(step.decidedById).toBe(manager.userId);
      expect(step.decidedAt).toBeTruthy();

      const audits = await db.auditLog.findMany({ where: { entityType: "PurchaseRequest", entityId: prId, action: "PURCHASE_REQUEST_APPROVED" } });
      expect(audits).toHaveLength(1);

      expect((await approvePR(app, manager.accessToken, prId)).status).toBe(409);
      expect((await rejectPR(app, manager.accessToken, prId)).status).toBe(409);
    });

    it("approving a DRAFT/APPROVED/REJECTED/CANCELLED purchase request is 409", async () => {
      const admin = await registerOrg(app, "Approve BadState Co");
      const draft = await postPROk(app, admin.accessToken);
      expect((await approvePR(app, admin.accessToken, draft.id)).status).toBe(409);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 44-57. REJECT
  // ────────────────────────────────────────────────────────────
  describe("reject", () => {
    it("ADMIN/MANAGER reject; SPECIALIST/EMPLOYEE/SUPPLIER denied; empty reason rejected by validation (400)", async () => {
      const admin = await registerOrg(app, "Reject RBAC Co");
      const specialist = await inviteAndLogin(app, admin, "PROCUREMENT_SPECIALIST");
      const employee = await inviteAndLogin(app, admin, "EMPLOYEE");
      const supplier = await inviteAndLogin(app, admin, "SUPPLIER");
      const manager = await inviteAndLogin(app, admin, "PROCUREMENT_MANAGER");

      const prAdmin = await createUnderApproval(app, admin);
      expect((await rejectPR(app, admin.accessToken, prAdmin)).status).toBe(200);

      const prManager = await createUnderApproval(app, admin);
      expect((await rejectPR(app, manager.accessToken, prManager)).status).toBe(200);

      const prSpecialist = await createUnderApproval(app, admin);
      expect((await rejectPR(app, specialist.accessToken, prSpecialist)).status).toBe(403);

      const prEmployee = await createUnderApproval(app, admin);
      expect((await rejectPR(app, employee.accessToken, prEmployee)).status).toBe(403);

      const prSupplier = await createUnderApproval(app, admin);
      expect((await rejectPR(app, supplier.accessToken, prSupplier)).status).toBe(403);

      const prEmptyReason = await createUnderApproval(app, admin);
      expect((await rejectPR(app, admin.accessToken, prEmptyReason, "")).status).toBe(400);
    });

    it("reject transitions PR/instance/step, persists reason to step.comment, sets decidedById/decidedAt/completedAt, writes one REJECTED audit; repeated reject -> 409; approve after reject -> 409", async () => {
      const admin = await registerOrg(app, "Reject Shape Co");
      const prId = await createUnderApproval(app, admin);

      const res = await rejectPR(app, admin.accessToken, prId, "Over budget");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("REJECTED");
      const approval = res.body.approval as Record<string, unknown>;
      expect(approval.status).toBe("REJECTED");
      expect(approval.completedAt).toBeTruthy();
      const step = approval.step as Record<string, unknown>;
      expect(step.status).toBe("REJECTED");
      expect(step.comment).toBe("Over budget");
      expect(step.decidedById).toBe(admin.userId);
      expect(step.decidedAt).toBeTruthy();

      const audits = await db.auditLog.findMany({ where: { entityType: "PurchaseRequest", entityId: prId, action: "PURCHASE_REQUEST_REJECTED" } });
      expect(audits).toHaveLength(1);

      expect((await rejectPR(app, admin.accessToken, prId)).status).toBe(409);
      expect((await approvePR(app, admin.accessToken, prId)).status).toBe(409);
    });

    it("rejected purchase request never resubmits (no REJECTED -> DRAFT path)", async () => {
      const admin = await registerOrg(app, "Reject NoResubmit Co");
      const prId = await createUnderApproval(app, admin);
      await rejectPR(app, admin.accessToken, prId);
      expect((await submitPR(app, admin.accessToken, prId)).status).toBe(409);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 58-63. DECISION CONCURRENCY
  // ────────────────────────────────────────────────────────────
  describe("approve vs reject race", () => {
    it("concurrent approve + reject on the same PR: exactly one succeeds, final state is internally consistent, exactly one decision audit exists", async () => {
      const admin = await registerOrg(app, "Decision Race Co");
      const prId = await createUnderApproval(app, admin);

      const [approveRes, rejectRes] = await Promise.all([approvePR(app, admin.accessToken, prId), rejectPR(app, admin.accessToken, prId)]);
      const statuses = [approveRes.status, rejectRes.status].sort();
      expect(statuses).toEqual([200, 409]);

      const final = await getPR(app, admin.accessToken, prId);
      const finalStatus = final.body.status as string;
      expect(["APPROVED", "REJECTED"]).toContain(finalStatus);
      const approval = final.body.approval as Record<string, unknown>;
      expect(approval.status).toBe(finalStatus);
      const step = approval.step as Record<string, unknown>;
      expect(step.status).toBe(finalStatus);

      const approvedAudits = await db.auditLog.count({ where: { entityType: "PurchaseRequest", entityId: prId, action: "PURCHASE_REQUEST_APPROVED" } });
      const rejectedAudits = await db.auditLog.count({ where: { entityType: "PurchaseRequest", entityId: prId, action: "PURCHASE_REQUEST_REJECTED" } });
      expect(approvedAudits + rejectedAudits).toBe(1);
      if (finalStatus === "APPROVED") {
        expect(approvedAudits).toBe(1);
        expect(rejectedAudits).toBe(0);
      } else {
        expect(approvedAudits).toBe(0);
        expect(rejectedAudits).toBe(1);
      }
    });
  });

  // ────────────────────────────────────────────────────────────
  // 64-80. CANCEL
  // ────────────────────────────────────────────────────────────
  describe("cancel", () => {
    it("EMPLOYEE cancels own DRAFT; cannot cancel another user's DRAFT; ADMIN/MANAGER cancel any DRAFT; SPECIALIST/APPROVER/SUPPLIER cannot cancel", async () => {
      const admin = await registerOrg(app, "Cancel DRAFT RBAC Co");
      const employeeA = await inviteAndLogin(app, admin, "EMPLOYEE");
      const employeeB = await inviteAndLogin(app, admin, "EMPLOYEE");
      const manager = await inviteAndLogin(app, admin, "PROCUREMENT_MANAGER");
      const specialist = await inviteAndLogin(app, admin, "PROCUREMENT_SPECIALIST");
      const approver = await inviteAndLogin(app, admin, "APPROVER");
      const supplier = await inviteAndLogin(app, admin, "SUPPLIER");

      const prOwn = await postPROk(app, employeeA.accessToken);
      const cancelOwn = await cancelPR(app, employeeA.accessToken, prOwn.id);
      expect(cancelOwn.status).toBe(200);
      expect(cancelOwn.body.status).toBe("CANCELLED");
      expect(cancelOwn.body.cancelledByUserId).toBe(employeeA.userId);
      expect(cancelOwn.body.cancelledAt).toBeTruthy();

      const prForeign = await postPROk(app, employeeA.accessToken);
      expect((await cancelPR(app, employeeB.accessToken, prForeign.id)).status).toBe(404);

      const prAdmin = await postPROk(app, admin.accessToken);
      expect((await cancelPR(app, admin.accessToken, prAdmin.id)).status).toBe(200);

      const prManager = await postPROk(app, admin.accessToken);
      expect((await cancelPR(app, manager.accessToken, prManager.id)).status).toBe(200);

      const prSpecialist = await postPROk(app, admin.accessToken);
      expect((await cancelPR(app, specialist.accessToken, prSpecialist.id)).status).toBe(403);

      const prApprover = await postPROk(app, admin.accessToken);
      expect((await cancelPR(app, approver.accessToken, prApprover.id)).status).toBe(403);

      const prSupplier = await postPROk(app, admin.accessToken);
      expect((await cancelPR(app, supplier.accessToken, prSupplier.id)).status).toBe(403);
    });

    it("cancel writes a CANCELLED audit; UNDER_APPROVAL/REJECTED/already-CANCELLED cannot cancel (409)", async () => {
      const admin = await registerOrg(app, "Cancel State Co");
      const prDraft = await postPROk(app, admin.accessToken);
      await cancelPR(app, admin.accessToken, prDraft.id);
      const audits = await db.auditLog.findMany({ where: { entityType: "PurchaseRequest", entityId: prDraft.id, action: "PURCHASE_REQUEST_CANCELLED" } });
      expect(audits).toHaveLength(1);
      expect((await cancelPR(app, admin.accessToken, prDraft.id)).status).toBe(409); // already CANCELLED

      const prUnderApproval = await createUnderApproval(app, admin);
      expect((await cancelPR(app, admin.accessToken, prUnderApproval)).status).toBe(409);

      const prRejected = await createUnderApproval(app, admin);
      await rejectPR(app, admin.accessToken, prRejected);
      expect((await cancelPR(app, admin.accessToken, prRejected)).status).toBe(409);
    });

    it("ADMIN/MANAGER cancel an APPROVED purchase request; EMPLOYEE cannot (403); approval history survives APPROVED -> CANCELLED", async () => {
      const admin = await registerOrg(app, "Cancel Approved Co");
      const employee = await inviteAndLogin(app, admin, "EMPLOYEE");
      const manager = await inviteAndLogin(app, admin, "PROCUREMENT_MANAGER");

      // Owned by the EMPLOYEE themselves (not admin) — visibilityWhere must
      // let them find it (ownership is fine), so the 403 below is proven to
      // come from the role/status check, not from a 404 ownership miss.
      const prForEmployee = await postPROk(app, employee.accessToken);
      await submitOk(app, employee.accessToken, prForEmployee.id);
      await approvePR(app, admin.accessToken, prForEmployee.id);
      expect((await cancelPR(app, employee.accessToken, prForEmployee.id)).status).toBe(403);

      const prForAdmin = await createUnderApproval(app, admin);
      await approvePR(app, admin.accessToken, prForAdmin);
      const cancelRes = await cancelPR(app, admin.accessToken, prForAdmin);
      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.status).toBe("CANCELLED");
      const approval = cancelRes.body.approval as Record<string, unknown>;
      expect(approval.status).toBe("APPROVED");
      const step = approval.step as Record<string, unknown>;
      expect(step.status).toBe("APPROVED");
      expect(step.decidedById).toBe(admin.userId);

      const prForManager = await createUnderApproval(app, admin);
      await approvePR(app, admin.accessToken, prForManager);
      expect((await cancelPR(app, manager.accessToken, prForManager)).status).toBe(200);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 81-102. ASSIGN BUYER
  // ────────────────────────────────────────────────────────────
  describe("assign buyer", () => {
    it("ADMIN assigns SPECIALIST/MANAGER; MANAGER assigns SPECIALIST; SPECIALIST/EMPLOYEE/APPROVER/SUPPLIER cannot assign", async () => {
      const admin = await registerOrg(app, "Assign RBAC Co");
      const manager = await inviteAndLogin(app, admin, "PROCUREMENT_MANAGER");
      const specialist = await inviteAndLogin(app, admin, "PROCUREMENT_SPECIALIST");
      const specialist2 = await inviteAndLogin(app, admin, "PROCUREMENT_SPECIALIST");
      const employee = await inviteAndLogin(app, admin, "EMPLOYEE");
      const approver = await inviteAndLogin(app, admin, "APPROVER");
      const supplier = await inviteAndLogin(app, admin, "SUPPLIER");

      const pr1 = await createUnderApproval(app, admin);
      expect((await assignBuyer(app, admin.accessToken, pr1, specialist.userId)).status).toBe(200);

      const pr2 = await createUnderApproval(app, admin);
      expect((await assignBuyer(app, admin.accessToken, pr2, manager.userId)).status).toBe(200);

      const pr3 = await createUnderApproval(app, admin);
      expect((await assignBuyer(app, manager.accessToken, pr3, specialist.userId)).status).toBe(200);

      const pr4 = await createUnderApproval(app, admin);
      expect((await assignBuyer(app, specialist.accessToken, pr4, specialist2.userId)).status).toBe(403);

      const pr5 = await createUnderApproval(app, admin);
      expect((await assignBuyer(app, employee.accessToken, pr5, specialist.userId)).status).toBe(403);

      const pr6 = await createUnderApproval(app, admin);
      expect((await assignBuyer(app, approver.accessToken, pr6, specialist.userId)).status).toBe(403);

      const pr7 = await createUnderApproval(app, admin);
      expect((await assignBuyer(app, supplier.accessToken, pr7, specialist.userId)).status).toBe(403);
    });

    it("target ADMIN/EMPLOYEE/APPROVER/SUPPLIER rejected (400); inactive target rejected (400); foreign-tenant target rejected safely (404)", async () => {
      const admin = await registerOrg(app, "Assign Target RBAC Co");
      const employee = await inviteAndLogin(app, admin, "EMPLOYEE");
      const approver = await inviteAndLogin(app, admin, "APPROVER");
      const supplier = await inviteAndLogin(app, admin, "SUPPLIER");
      const specialist = await inviteAndLogin(app, admin, "PROCUREMENT_SPECIALIST");
      const otherOrg = await registerOrg(app, "Assign Other Org Co");

      const prToAdmin = await createUnderApproval(app, admin);
      expect((await assignBuyer(app, admin.accessToken, prToAdmin, admin.userId)).status).toBe(400);

      const prToEmployee = await createUnderApproval(app, admin);
      expect((await assignBuyer(app, admin.accessToken, prToEmployee, employee.userId)).status).toBe(400);

      const prToApprover = await createUnderApproval(app, admin);
      expect((await assignBuyer(app, admin.accessToken, prToApprover, approver.userId)).status).toBe(400);

      const prToSupplier = await createUnderApproval(app, admin);
      expect((await assignBuyer(app, admin.accessToken, prToSupplier, supplier.userId)).status).toBe(400);

      await db.user.update({ where: { id: specialist.userId }, data: { active: false } });
      const prToInactive = await createUnderApproval(app, admin);
      expect((await assignBuyer(app, admin.accessToken, prToInactive, specialist.userId)).status).toBe(400);

      const prToForeign = await createUnderApproval(app, admin);
      expect((await assignBuyer(app, admin.accessToken, prToForeign, otherOrg.userId)).status).toBe(404);
    });

    it("assignable in UNDER_APPROVAL/APPROVED; DRAFT/REJECTED/CANCELLED rejected (409)", async () => {
      const admin = await registerOrg(app, "Assign States Co");
      const specialist = await inviteAndLogin(app, admin, "PROCUREMENT_SPECIALIST");

      const prDraft = await postPROk(app, admin.accessToken);
      expect((await assignBuyer(app, admin.accessToken, prDraft.id, specialist.userId)).status).toBe(409);

      const prUnderApproval = await createUnderApproval(app, admin);
      expect((await assignBuyer(app, admin.accessToken, prUnderApproval, specialist.userId)).status).toBe(200);

      const prApproved = await createUnderApproval(app, admin);
      await approvePR(app, admin.accessToken, prApproved);
      expect((await assignBuyer(app, admin.accessToken, prApproved, specialist.userId)).status).toBe(200);

      const prRejected = await createUnderApproval(app, admin);
      await rejectPR(app, admin.accessToken, prRejected);
      expect((await assignBuyer(app, admin.accessToken, prRejected, specialist.userId)).status).toBe(409);

      const prCancelled = await postPROk(app, admin.accessToken);
      await cancelPR(app, admin.accessToken, prCancelled.id);
      expect((await assignBuyer(app, admin.accessToken, prCancelled.id, specialist.userId)).status).toBe(409);
    });

    it("same-buyer reassignment is a no-op (no audit); actual (re)assignment writes an ASSIGNED audit with old/new buyer ids", async () => {
      const admin = await registerOrg(app, "Assign NoOp Co");
      const specialistA = await inviteAndLogin(app, admin, "PROCUREMENT_SPECIALIST");
      const specialistB = await inviteAndLogin(app, admin, "PROCUREMENT_SPECIALIST");
      const prId = await createUnderApproval(app, admin);

      const first = await assignBuyer(app, admin.accessToken, prId, specialistA.userId);
      expect(first.status).toBe(200);
      expect(first.body.assignedBuyerUserId).toBe(specialistA.userId);

      const auditsAfterFirst = await db.auditLog.findMany({ where: { entityType: "PurchaseRequest", entityId: prId, action: "PURCHASE_REQUEST_ASSIGNED" } });
      expect(auditsAfterFirst).toHaveLength(1);

      const noop = await assignBuyer(app, admin.accessToken, prId, specialistA.userId);
      expect(noop.status).toBe(200);
      const auditsAfterNoop = await db.auditLog.findMany({ where: { entityType: "PurchaseRequest", entityId: prId, action: "PURCHASE_REQUEST_ASSIGNED" } });
      expect(auditsAfterNoop).toHaveLength(1); // still one — no-op wrote nothing

      const second = await assignBuyer(app, admin.accessToken, prId, specialistB.userId);
      expect(second.status).toBe(200);
      expect(second.body.assignedBuyerUserId).toBe(specialistB.userId);
      const auditsAfterSecond = await db.auditLog.findMany({
        where: { entityType: "PurchaseRequest", entityId: prId, action: "PURCHASE_REQUEST_ASSIGNED" },
        orderBy: { createdAt: "asc" },
      });
      expect(auditsAfterSecond).toHaveLength(2);
      const latest = auditsAfterSecond[1]!;
      expect((latest.oldValue as Record<string, unknown>).assignedBuyerUserId).toBe(specialistA.userId);
      expect((latest.newValue as Record<string, unknown>).assignedBuyerUserId).toBe(specialistB.userId);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 103-108. DETAIL APPROVAL VIEW
  // ────────────────────────────────────────────────────────────
  describe("detail approval view", () => {
    it("DRAFT detail approval=null; submitted exposes PENDING; approved exposes decision; rejected exposes reason; cancelled-after-approved keeps original approval history; list stays lightweight", async () => {
      const admin = await registerOrg(app, "Detail Approval Co");

      const prDraft = await postPROk(app, admin.accessToken);
      const draftDetail = await getPR(app, admin.accessToken, prDraft.id);
      expect(draftDetail.body.approval).toBeNull();

      const prSubmitted = await postPROk(app, admin.accessToken);
      await submitOk(app, admin.accessToken, prSubmitted.id);
      const submittedDetail = await getPR(app, admin.accessToken, prSubmitted.id);
      expect((submittedDetail.body.approval as Record<string, unknown>).status).toBe("PENDING");

      const prApproved = await createUnderApproval(app, admin);
      await approvePR(app, admin.accessToken, prApproved);
      const approvedDetail = await getPR(app, admin.accessToken, prApproved);
      expect((approvedDetail.body.approval as Record<string, unknown>).status).toBe("APPROVED");

      const prRejected = await createUnderApproval(app, admin);
      await rejectPR(app, admin.accessToken, prRejected, "Duplicate request");
      const rejectedDetail = await getPR(app, admin.accessToken, prRejected);
      const rejectedApproval = rejectedDetail.body.approval as Record<string, unknown>;
      expect((rejectedApproval.step as Record<string, unknown>).comment).toBe("Duplicate request");

      const prCancelledAfterApproved = await createUnderApproval(app, admin);
      await approvePR(app, admin.accessToken, prCancelledAfterApproved);
      await cancelPR(app, admin.accessToken, prCancelledAfterApproved);
      const cancelledDetail = await getPR(app, admin.accessToken, prCancelledAfterApproved);
      expect(cancelledDetail.body.status).toBe("CANCELLED");
      expect((cancelledDetail.body.approval as Record<string, unknown>).status).toBe("APPROVED");

      const list = await authed(app, admin.accessToken).get("/api/v1/purchase-requests?pageSize=50");
      const listItem = (list.body.items as Array<Record<string, unknown>>)[0];
      expect(listItem).not.toHaveProperty("approval");
    });
  });

  // ────────────────────────────────────────────────────────────
  // 109-115. TENANT / IDOR
  // ────────────────────────────────────────────────────────────
  describe("tenant isolation / IDOR", () => {
    it("Org A cannot submit/approve/reject/cancel/assign an Org B purchase request, and no foreign approval data leaks through detail", async () => {
      const orgA = await registerOrg(app, "Tenant A Co");
      const orgB = await registerOrg(app, "Tenant B Co");
      const specialistB = await inviteAndLogin(app, orgB, "PROCUREMENT_SPECIALIST");

      const prB = await postPROk(app, orgB.accessToken);
      expect((await submitPR(app, orgA.accessToken, prB.id)).status).toBe(404);

      const prBUnderApproval = await createUnderApproval(app, orgB);
      expect((await approvePR(app, orgA.accessToken, prBUnderApproval)).status).toBe(404);
      expect((await rejectPR(app, orgA.accessToken, prBUnderApproval)).status).toBe(404);

      const prBDraft = await postPROk(app, orgB.accessToken);
      expect((await cancelPR(app, orgA.accessToken, prBDraft.id)).status).toBe(404);

      expect((await assignBuyer(app, orgA.accessToken, prBUnderApproval, specialistB.userId)).status).toBe(404);

      // Foreign buyer (Org B's specialist) cannot be assigned within Org A, even to Org A's own PR.
      const prA = await createUnderApproval(app, orgA);
      expect((await assignBuyer(app, orgA.accessToken, prA, specialistB.userId)).status).toBe(404);

      // No leak: Org A cannot read Org B's PR detail (and therefore no approval data) at all.
      expect((await getPR(app, orgA.accessToken, prBUnderApproval)).status).toBe(404);
    });
  });

  // ────────────────────────────────────────────────────────────
  // TRANSACTION ROLLBACK
  // ────────────────────────────────────────────────────────────
  describe("transaction rollback", () => {
    it("a submit that loses the concurrency race leaves no partial approval rows and the surviving row's state matches the DB exactly", async () => {
      const admin = await registerOrg(app, "Rollback Submit Co");
      const pr = await postPROk(app, admin.accessToken);

      const [r1, r2] = await Promise.all([submitPR(app, admin.accessToken, pr.id), submitPR(app, admin.accessToken, pr.id)]);
      const loserStatus = [r1, r2].find((r) => r.status === 409);
      expect(loserStatus).toBeDefined();

      const dbPr = await db.purchaseRequest.findUniqueOrThrow({ where: { id: pr.id } });
      expect(dbPr.status).toBe("UNDER_APPROVAL");
      const instances = await db.approvalInstance.findMany({ where: { purchaseRequestId: pr.id } });
      expect(instances).toHaveLength(1);
    });

    it("a failed approve/reject (lost race) leaves the PR/instance/step in a single consistent decided state, never partially applied", async () => {
      const admin = await registerOrg(app, "Rollback Decision Co");
      const prId = await createUnderApproval(app, admin);

      await Promise.all([approvePR(app, admin.accessToken, prId), rejectPR(app, admin.accessToken, prId)]);

      const dbPr = await db.purchaseRequest.findUniqueOrThrow({ where: { id: prId } });
      const dbInstance = await db.approvalInstance.findUniqueOrThrow({ where: { purchaseRequestId: prId } });
      const dbSteps = await db.approvalStepInstance.findMany({ where: { approvalInstanceId: dbInstance.id } });
      expect(dbSteps).toHaveLength(1);
      // All three must agree — no possibility of e.g. PR=APPROVED but step=REJECTED.
      expect(dbPr.status).toBe(dbInstance.status);
      expect(dbInstance.status).toBe(dbSteps[0]!.status);
      expect(dbSteps[0]!.decidedById).not.toBeNull();
      expect(dbSteps[0]!.decidedAt).not.toBeNull();
    });

    it("a failed cancel (wrong status) leaves the purchase request's status/cancelledAt/cancelledByUserId completely unchanged", async () => {
      const admin = await registerOrg(app, "Rollback Cancel Co");
      const prId = await createUnderApproval(app, admin);

      const before = await db.purchaseRequest.findUniqueOrThrow({ where: { id: prId } });
      const res = await cancelPR(app, admin.accessToken, prId);
      expect(res.status).toBe(409);

      const after = await db.purchaseRequest.findUniqueOrThrow({ where: { id: prId } });
      expect(after.status).toBe(before.status);
      expect(after.cancelledAt).toBeNull();
      expect(after.cancelledByUserId).toBeNull();
    });

    it("a failed assignment (invalid target) leaves assignedBuyerUserId completely unchanged", async () => {
      const admin = await registerOrg(app, "Rollback Assign Co");
      const employee = await inviteAndLogin(app, admin, "EMPLOYEE");
      const prId = await createUnderApproval(app, admin);

      const before = await db.purchaseRequest.findUniqueOrThrow({ where: { id: prId } });
      expect(before.assignedBuyerUserId).toBeNull();

      const res = await assignBuyer(app, admin.accessToken, prId, employee.userId);
      expect(res.status).toBe(400);

      const after = await db.purchaseRequest.findUniqueOrThrow({ where: { id: prId } });
      expect(after.assignedBuyerUserId).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────
  // M3.1 Phase F §36/§37 — consolidated RBAC and tenant/IDOR matrices.
  // These complement (never replace) the scattered per-action RBAC/tenant
  // tests already in this file and in purchase-requests.e2e.spec.ts /
  // purchase-requests-read.e2e.spec.ts — this is a single audit-legible
  // proof of the FULL action x role / action x tenant grid in one place.
  // ────────────────────────────────────────────────────────────
  describe("final RBAC / IDOR matrix", () => {
    function postPR(app: INestApplication, token: string, body: Record<string, unknown>) {
      return authed(app, token).post("/api/v1/purchase-requests").send(body);
    }
    function patchPR(app: INestApplication, token: string, id: string, body: Record<string, unknown>) {
      return authed(app, token).patch(`/api/v1/purchase-requests/${id}`).send(body);
    }

    it("complete role x action authorization matrix (create/read/edit-draft/submit/approve/reject/cancel/assign)", async () => {
      const admin = await registerOrg(app, "Matrix RBAC Co");
      const manager = await inviteAndLogin(app, admin, "PROCUREMENT_MANAGER");
      const specialist = await inviteAndLogin(app, admin, "PROCUREMENT_SPECIALIST");
      const employee = await inviteAndLogin(app, admin, "EMPLOYEE");
      const approver = await inviteAndLogin(app, admin, "APPROVER");
      const supplier = await inviteAndLogin(app, admin, "SUPPLIER");

      // CREATE — target-less; each role acts on its own behalf.
      const createExpected: Record<string, number> = {
        ADMIN: 201,
        PROCUREMENT_MANAGER: 201,
        PROCUREMENT_SPECIALIST: 201,
        EMPLOYEE: 201,
        APPROVER: 403,
        SUPPLIER: 403,
      };
      for (const [role, ctx] of Object.entries({ ADMIN: admin, PROCUREMENT_MANAGER: manager, PROCUREMENT_SPECIALIST: specialist, EMPLOYEE: employee, APPROVER: approver, SUPPLIER: supplier })) {
        const res = await postPR(app, ctx.accessToken, { items: [freeTextItem] });
        expect(res.status).toBe(createExpected[role]);
      }

      // READ (detail) — one ADMIN-owned target; EMPLOYEE/APPROVER see zero (404, ownership/assignment-scoped, not a role ban), SUPPLIER is role-banned (403).
      const readTarget = await postPROk(app, admin.accessToken);
      const readExpected: Record<string, number> = {
        ADMIN: 200,
        PROCUREMENT_MANAGER: 200,
        PROCUREMENT_SPECIALIST: 200,
        EMPLOYEE: 404,
        APPROVER: 404,
        SUPPLIER: 403,
      };
      for (const [role, ctx] of Object.entries({ ADMIN: admin, PROCUREMENT_MANAGER: manager, PROCUREMENT_SPECIALIST: specialist, EMPLOYEE: employee, APPROVER: approver, SUPPLIER: supplier })) {
        expect((await getPR(app, ctx.accessToken, readTarget.id)).status).toBe(readExpected[role]);
      }

      // EDIT DRAFT (header PATCH) — same shape as read.
      const editTarget = await postPROk(app, admin.accessToken);
      const editExpected: Record<string, number> = {
        ADMIN: 200,
        PROCUREMENT_MANAGER: 200,
        PROCUREMENT_SPECIALIST: 200,
        EMPLOYEE: 404,
        APPROVER: 403,
        SUPPLIER: 403,
      };
      for (const [role, ctx] of Object.entries({ ADMIN: admin, PROCUREMENT_MANAGER: manager, PROCUREMENT_SPECIALIST: specialist, EMPLOYEE: employee, APPROVER: approver, SUPPLIER: supplier })) {
        // Each attempt targets its own fresh DRAFT so a successful PATCH by
        // one role never interferes with the next role's attempt.
        const target = editExpected[role] === 200 ? await postPROk(app, admin.accessToken) : editTarget;
        expect((await patchPR(app, ctx.accessToken, target.id, { reason: "matrix edit" })).status).toBe(editExpected[role]);
      }

      // SUBMIT — DRAFT required; fresh per successful role, shared for the denied ones (never mutated).
      const submitDenyTarget = await postPROk(app, admin.accessToken);
      const submitExpected: Record<string, number> = {
        ADMIN: 200,
        PROCUREMENT_MANAGER: 200,
        PROCUREMENT_SPECIALIST: 200,
        EMPLOYEE: 404,
        APPROVER: 403,
        SUPPLIER: 403,
      };
      for (const [role, ctx] of Object.entries({ ADMIN: admin, PROCUREMENT_MANAGER: manager, PROCUREMENT_SPECIALIST: specialist, EMPLOYEE: employee, APPROVER: approver, SUPPLIER: supplier })) {
        const target = submitExpected[role] === 200 ? await postPROk(app, admin.accessToken) : submitDenyTarget;
        expect((await submitPR(app, ctx.accessToken, target.id)).status).toBe(submitExpected[role]);
      }

      // APPROVE — UNDER_APPROVAL required; fresh per successful role, shared for denied (never mutated).
      const approveDenyTarget = await createUnderApproval(app, admin);
      const approveExpected: Record<string, number> = {
        ADMIN: 200,
        PROCUREMENT_MANAGER: 200,
        PROCUREMENT_SPECIALIST: 403,
        EMPLOYEE: 403,
        APPROVER: 404, // in @Roles, but unassigned -> visibility-scoped miss
        SUPPLIER: 403,
      };
      for (const [role, ctx] of Object.entries({ ADMIN: admin, PROCUREMENT_MANAGER: manager, PROCUREMENT_SPECIALIST: specialist, EMPLOYEE: employee, APPROVER: approver, SUPPLIER: supplier })) {
        const targetId = approveExpected[role] === 200 ? await createUnderApproval(app, admin) : approveDenyTarget;
        expect((await approvePR(app, ctx.accessToken, targetId)).status).toBe(approveExpected[role]);
      }

      // REJECT — identical shape to approve.
      const rejectDenyTarget = await createUnderApproval(app, admin);
      const rejectExpected: Record<string, number> = {
        ADMIN: 200,
        PROCUREMENT_MANAGER: 200,
        PROCUREMENT_SPECIALIST: 403,
        EMPLOYEE: 403,
        APPROVER: 404,
        SUPPLIER: 403,
      };
      for (const [role, ctx] of Object.entries({ ADMIN: admin, PROCUREMENT_MANAGER: manager, PROCUREMENT_SPECIALIST: specialist, EMPLOYEE: employee, APPROVER: approver, SUPPLIER: supplier })) {
        const targetId = rejectExpected[role] === 200 ? await createUnderApproval(app, admin) : rejectDenyTarget;
        expect((await rejectPR(app, ctx.accessToken, targetId)).status).toBe(rejectExpected[role]);
      }

      // CANCEL (DRAFT) — fresh per successful role, shared for denied.
      const cancelDenyTarget = await postPROk(app, admin.accessToken);
      const cancelExpected: Record<string, number> = {
        ADMIN: 200,
        PROCUREMENT_MANAGER: 200,
        PROCUREMENT_SPECIALIST: 403,
        EMPLOYEE: 404, // in @Roles, but not the owner of this admin-created DRAFT
        APPROVER: 403,
        SUPPLIER: 403,
      };
      for (const [role, ctx] of Object.entries({ ADMIN: admin, PROCUREMENT_MANAGER: manager, PROCUREMENT_SPECIALIST: specialist, EMPLOYEE: employee, APPROVER: approver, SUPPLIER: supplier })) {
        const target = cancelExpected[role] === 200 ? await postPROk(app, admin.accessToken) : cancelDenyTarget;
        expect((await cancelPR(app, ctx.accessToken, target.id)).status).toBe(cancelExpected[role]);
      }

      // ASSIGN — target buyer is always the (eligible) specialist; PR state is untouched by a denied attempt.
      const assignDenyTarget = await createUnderApproval(app, admin);
      const assignExpected: Record<string, number> = {
        ADMIN: 200,
        PROCUREMENT_MANAGER: 200,
        PROCUREMENT_SPECIALIST: 403,
        EMPLOYEE: 403,
        APPROVER: 403,
        SUPPLIER: 403,
      };
      for (const [role, ctx] of Object.entries({ ADMIN: admin, PROCUREMENT_MANAGER: manager, PROCUREMENT_SPECIALIST: specialist, EMPLOYEE: employee, APPROVER: approver, SUPPLIER: supplier })) {
        const targetId = assignExpected[role] === 200 ? await createUnderApproval(app, admin) : assignDenyTarget;
        expect((await assignBuyer(app, ctx.accessToken, targetId, specialist.userId)).status).toBe(assignExpected[role]);
      }
    });

    it("complete cross-tenant IDOR matrix: Org A can reach none of Org B's purchase-request data or mutations", async () => {
      const orgA = await registerOrg(app, "Matrix IDOR A Co");
      const orgB = await registerOrg(app, "Matrix IDOR B Co");

      const bDraftRes = await authed(app, orgB.accessToken).post("/api/v1/purchase-requests").send({ items: [freeTextItem] });
      const bDraft = bDraftRes.body as { id: string; items: Array<{ id: string }> };
      const bItemId = bDraft.items[0]?.id;
      const bUnderApproval = await createUnderApproval(app, orgB);
      const bDraftForCancel = await postPROk(app, orgB.accessToken);

      // list never includes Org B's PRs
      const list = await authed(app, orgA.accessToken).get("/api/v1/purchase-requests?pageSize=100");
      const ids = (list.body.items as Array<{ id: string }>).map((i) => i.id);
      expect(ids).not.toContain(bDraft.id);
      expect(ids).not.toContain(bUnderApproval);

      expect((await getPR(app, orgA.accessToken, bDraft.id)).status).toBe(404);
      expect((await patchPR(app, orgA.accessToken, bDraft.id, { reason: "idor" })).status).toBe(404);
      expect((await authed(app, orgA.accessToken).post(`/api/v1/purchase-requests/${bDraft.id}/items`).send(freeTextItem)).status).toBe(404);
      if (bItemId) {
        expect((await authed(app, orgA.accessToken).patch(`/api/v1/purchase-requests/${bDraft.id}/items/${bItemId}`).send({ notes: "idor" })).status).toBe(404);
        expect((await authed(app, orgA.accessToken).delete(`/api/v1/purchase-requests/${bDraft.id}/items/${bItemId}`)).status).toBe(404);
      }
      expect((await submitPR(app, orgA.accessToken, bDraft.id)).status).toBe(404);
      expect((await approvePR(app, orgA.accessToken, bUnderApproval)).status).toBe(404);
      expect((await rejectPR(app, orgA.accessToken, bUnderApproval)).status).toBe(404);
      expect((await cancelPR(app, orgA.accessToken, bDraftForCancel.id)).status).toBe(404);
      expect((await assignBuyer(app, orgA.accessToken, bUnderApproval, orgA.userId)).status).toBe(404);
    });
  });
});
