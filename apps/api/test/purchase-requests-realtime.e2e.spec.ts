import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { io, type Socket as ClientSocket } from "socket.io-client";
import { createSystemPrismaClient } from "@top/database";
import { REALTIME_EVENT_NAME, type DomainEvent } from "@top/types";
import { createTestApp, uniqueEmail } from "./test-app";
import { RealtimeGateway } from "../src/realtime/realtime.gateway";

/**
 * M3.1 Phase F — Purchase Request workflow realtime events
 * (PURCHASE_REQUEST_SUBMITTED/_APPROVED/_REJECTED/_ASSIGNED/_CANCELLED),
 * strictly-post-commit publication, tenant room isolation, and the
 * best-effort/publish-never-breaks-HTTP contract. Reuses the same
 * app.listen(0) + socket.io-client pattern as realtime.e2e.spec.ts — see
 * that file's own doc comment for why a real TCP port is needed here.
 */

interface OrgContext {
  email: string;
  accessToken: string;
  userId: string;
  organizationId: string;
}

async function registerOrg(app: INestApplication, orgName: string): Promise<OrgContext> {
  const email = uniqueEmail("prrt");
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

const freeTextItem = { itemName: "Realtime test item", quantity: "10.000", uomCode: "PCS" };

async function postPROk(app: INestApplication, token: string, body: Record<string, unknown> = { items: [freeTextItem] }) {
  const res = await authed(app, token).post("/api/v1/purchase-requests").send(body);
  if (res.status !== 201) throw new Error(`postPR failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string; requestNumber: string };
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
async function createUnderApproval(app: INestApplication, admin: OrgContext): Promise<string> {
  const pr = await postPROk(app, admin.accessToken);
  await submitOk(app, admin.accessToken, pr.id);
  return pr.id;
}

function waitConnect(client: ClientSocket, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("connect timeout")), timeoutMs);
    client.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    client.once("connect_error", (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
    client.connect();
  });
}

function waitEvent(client: ClientSocket, timeoutMs = 5000): Promise<DomainEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for a domain event")), timeoutMs);
    client.once(REALTIME_EVENT_NAME, (evt: DomainEvent) => {
      clearTimeout(timer);
      resolve(evt);
    });
  });
}

/** Negative-assertion helper — resolves null if nothing arrives within waitMs. */
function waitNoEvent(client: ClientSocket, waitMs = 700): Promise<DomainEvent | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), waitMs);
    client.once(REALTIME_EVENT_NAME, (evt: DomainEvent) => {
      clearTimeout(timer);
      resolve(evt);
    });
  });
}

/** Collects every event received on a client for a bounded window, for tests that need an ordered history rather than a single event. */
function collectEvents(client: ClientSocket, windowMs: number): { events: DomainEvent[]; done: Promise<DomainEvent[]> } {
  const events: DomainEvent[] = [];
  const handler = (evt: DomainEvent) => events.push(evt);
  client.on(REALTIME_EVENT_NAME, handler);
  const done = new Promise<DomainEvent[]>((resolve) => {
    setTimeout(() => {
      client.off(REALTIME_EVENT_NAME, handler);
      resolve(events);
    }, windowMs);
  });
  return { events, done };
}

describe("M3.1 Phase F — Purchase Request workflow realtime events", () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createSystemPrismaClient>;
  const openClients: ClientSocket[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen(0);
    const address = app.getHttpServer().address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
    db = createSystemPrismaClient();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    for (const c of openClients.splice(0)) {
      c.removeAllListeners();
      c.close();
    }
  });

  function client(token: string): ClientSocket {
    const c = io(baseUrl, { autoConnect: false, transports: ["websocket"], reconnection: false, auth: { token } });
    openClients.push(c);
    return c;
  }

  // ────────────────────────────────────────────────────────────
  // SUBMIT
  // ────────────────────────────────────────────────────────────
  describe("submit realtime", () => {
    it("successful submit produces exactly one correctly-shaped PURCHASE_REQUEST_SUBMITTED, and REST detail agrees", async () => {
      const admin = await registerOrg(app, "RT Submit Co");
      const pr = await postPROk(app, admin.accessToken);
      const c = client(admin.accessToken);
      await waitConnect(c);

      const eventPromise = waitEvent(c);
      const submitRes = await submitPR(app, admin.accessToken, pr.id);
      expect(submitRes.status).toBe(200);
      const evt = await eventPromise;

      expect(evt.eventType).toBe("PURCHASE_REQUEST_SUBMITTED");
      expect(evt.entityType).toBe("PurchaseRequest");
      expect(evt.entityId).toBe(pr.id);
      expect(evt.organizationId).toBe(admin.organizationId);
      expect(evt.actorUserId).toBe(admin.userId);
      expect(evt.payload).toEqual({ status: "UNDER_APPROVAL" });

      const detail = await authed(app, admin.accessToken).get(`/api/v1/purchase-requests/${pr.id}`);
      expect(detail.body.status).toBe("UNDER_APPROVAL");
    });

    it("no event on: repeated submit (409), empty-DRAFT submit (409), lost concurrency race (409)", async () => {
      const admin = await registerOrg(app, "RT Submit NoEvent Co");
      const c = client(admin.accessToken);
      await waitConnect(c);

      // repeated submit
      const pr1 = await postPROk(app, admin.accessToken);
      await submitOk(app, admin.accessToken, pr1.id);
      let noEvent = waitNoEvent(c);
      expect((await submitPR(app, admin.accessToken, pr1.id)).status).toBe(409);
      expect(await noEvent).toBeNull();

      // empty DRAFT
      const created = await authed(app, admin.accessToken).post("/api/v1/purchase-requests").send({ items: [freeTextItem] });
      const itemId = (created.body.items as Array<{ id: string }>)[0]!.id;
      await authed(app, admin.accessToken).delete(`/api/v1/purchase-requests/${created.body.id}/items/${itemId}`);
      noEvent = waitNoEvent(c);
      expect((await submitPR(app, admin.accessToken, created.body.id)).status).toBe(409);
      expect(await noEvent).toBeNull();

      // lost concurrency race — the loser's transaction throws BEFORE ever
      // reaching the ApprovalInstance/audit writes, i.e. before commit, so
      // it structurally can never publish (Phase F §33).
      const pr2 = await postPROk(app, admin.accessToken);
      const collector = collectEvents(c, 1000);
      const [r1, r2] = await Promise.all([submitPR(app, admin.accessToken, pr2.id), submitPR(app, admin.accessToken, pr2.id)]);
      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([200, 409]);
      const events = await collector.done;
      expect(events).toHaveLength(1); // exactly the winner's event, never two
      expect(events[0]!.eventType).toBe("PURCHASE_REQUEST_SUBMITTED");
    });
  });

  // ────────────────────────────────────────────────────────────
  // APPROVE / REJECT
  // ────────────────────────────────────────────────────────────
  describe("approve / reject realtime", () => {
    it("successful approve produces exactly one PURCHASE_REQUEST_APPROVED", async () => {
      const admin = await registerOrg(app, "RT Approve Co");
      const prId = await createUnderApproval(app, admin);
      const c = client(admin.accessToken);
      await waitConnect(c);

      const eventPromise = waitEvent(c);
      const res = await approvePR(app, admin.accessToken, prId);
      expect(res.status).toBe(200);
      const evt = await eventPromise;
      expect(evt.eventType).toBe("PURCHASE_REQUEST_APPROVED");
      expect(evt.entityId).toBe(prId);
      expect(evt.payload).toEqual({ status: "APPROVED" });
    });

    it("successful reject produces exactly one PURCHASE_REQUEST_REJECTED whose payload never contains the reason/comment", async () => {
      const admin = await registerOrg(app, "RT Reject Co");
      const prId = await createUnderApproval(app, admin);
      const c = client(admin.accessToken);
      await waitConnect(c);

      const eventPromise = waitEvent(c);
      const res = await rejectPR(app, admin.accessToken, prId, "Duplicate spend request");
      expect(res.status).toBe(200);
      const evt = await eventPromise;
      expect(evt.eventType).toBe("PURCHASE_REQUEST_REJECTED");
      expect(evt.payload).toEqual({ status: "REJECTED" });
      const serialized = JSON.stringify(evt).toLowerCase();
      expect(serialized).not.toContain("duplicate spend request");
      expect(evt).not.toHaveProperty("payload.reason");
      expect(evt).not.toHaveProperty("payload.comment");
    });

    it("no event on: repeated approve (409), reject-after-approve (409), approving a DRAFT (409)", async () => {
      const admin = await registerOrg(app, "RT Decision NoEvent Co");
      const c = client(admin.accessToken);
      await waitConnect(c);

      const prId = await createUnderApproval(app, admin);
      await approvePR(app, admin.accessToken, prId);

      let noEvent = waitNoEvent(c);
      expect((await approvePR(app, admin.accessToken, prId)).status).toBe(409);
      expect(await noEvent).toBeNull();

      noEvent = waitNoEvent(c);
      expect((await rejectPR(app, admin.accessToken, prId)).status).toBe(409);
      expect(await noEvent).toBeNull();

      const draft = await postPROk(app, admin.accessToken);
      noEvent = waitNoEvent(c);
      expect((await approvePR(app, admin.accessToken, draft.id)).status).toBe(409);
      expect(await noEvent).toBeNull();
    });

    it("approve vs reject race: exactly one decision event exists, and it matches the persisted final state", async () => {
      const admin = await registerOrg(app, "RT Decision Race Co");
      const prId = await createUnderApproval(app, admin);
      const c = client(admin.accessToken);
      await waitConnect(c);

      const collector = collectEvents(c, 1200);
      const [approveRes, rejectRes] = await Promise.all([approvePR(app, admin.accessToken, prId), rejectPR(app, admin.accessToken, prId)]);
      const statuses = [approveRes.status, rejectRes.status].sort();
      expect(statuses).toEqual([200, 409]);

      const events = await collector.done;
      expect(events).toHaveLength(1);
      const dbPr = await db.purchaseRequest.findUniqueOrThrow({ where: { id: prId } });
      if (dbPr.status === "APPROVED") {
        expect(events[0]!.eventType).toBe("PURCHASE_REQUEST_APPROVED");
      } else {
        expect(dbPr.status).toBe("REJECTED");
        expect(events[0]!.eventType).toBe("PURCHASE_REQUEST_REJECTED");
      }
    });
  });

  // ────────────────────────────────────────────────────────────
  // CANCEL
  // ────────────────────────────────────────────────────────────
  describe("cancel realtime", () => {
    it("DRAFT -> CANCELLED and APPROVED -> CANCELLED each produce exactly one PURCHASE_REQUEST_CANCELLED", async () => {
      const admin = await registerOrg(app, "RT Cancel Co");
      const c = client(admin.accessToken);
      await waitConnect(c);

      const draft = await postPROk(app, admin.accessToken);
      const eventPromise1 = waitEvent(c);
      expect((await cancelPR(app, admin.accessToken, draft.id)).status).toBe(200);
      const evt1 = await eventPromise1;
      expect(evt1.eventType).toBe("PURCHASE_REQUEST_CANCELLED");
      expect(evt1.payload).toEqual({ status: "CANCELLED" });

      const approvedId = await createUnderApproval(app, admin);
      await approvePR(app, admin.accessToken, approvedId);
      const eventPromise2 = waitEvent(c);
      expect((await cancelPR(app, admin.accessToken, approvedId)).status).toBe(200);
      const evt2 = await eventPromise2;
      expect(evt2.eventType).toBe("PURCHASE_REQUEST_CANCELLED");
      expect(evt2.entityId).toBe(approvedId);
    });

    it("no event when cancel is rejected (UNDER_APPROVAL, 409)", async () => {
      const admin = await registerOrg(app, "RT Cancel NoEvent Co");
      const prId = await createUnderApproval(app, admin);
      const c = client(admin.accessToken);
      await waitConnect(c);

      const noEvent = waitNoEvent(c);
      expect((await cancelPR(app, admin.accessToken, prId)).status).toBe(409);
      expect(await noEvent).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────
  // ASSIGN
  // ────────────────────────────────────────────────────────────
  describe("assign realtime", () => {
    it("an actual buyer change produces exactly one PURCHASE_REQUEST_ASSIGNED with the target buyer id", async () => {
      const admin = await registerOrg(app, "RT Assign Co");
      const specialist = await inviteAndLogin(app, admin, "PROCUREMENT_SPECIALIST");
      const prId = await createUnderApproval(app, admin);
      const c = client(admin.accessToken);
      await waitConnect(c);

      const eventPromise = waitEvent(c);
      const res = await assignBuyer(app, admin.accessToken, prId, specialist.userId);
      expect(res.status).toBe(200);
      const evt = await eventPromise;
      expect(evt.eventType).toBe("PURCHASE_REQUEST_ASSIGNED");
      expect(evt.payload).toEqual({ assignedBuyerUserId: specialist.userId });
    });

    it("a same-buyer no-op assignment produces zero events; an invalid-target assignment produces zero events", async () => {
      const admin = await registerOrg(app, "RT Assign NoEvent Co");
      const specialist = await inviteAndLogin(app, admin, "PROCUREMENT_SPECIALIST");
      const employee = await inviteAndLogin(app, admin, "EMPLOYEE");
      const prId = await createUnderApproval(app, admin);
      const c = client(admin.accessToken);
      await waitConnect(c);

      await assignBuyer(app, admin.accessToken, prId, specialist.userId);

      let noEvent = waitNoEvent(c);
      const noop = await assignBuyer(app, admin.accessToken, prId, specialist.userId);
      expect(noop.status).toBe(200);
      expect(await noEvent).toBeNull();

      noEvent = waitNoEvent(c);
      const invalidTarget = await assignBuyer(app, admin.accessToken, prId, employee.userId);
      expect(invalidTarget.status).toBe(400);
      expect(await noEvent).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────
  // TENANT ROOM ISOLATION
  // ────────────────────────────────────────────────────────────
  describe("cross-tenant isolation", () => {
    it("Org B never receives an event triggered by an Org A purchase request workflow action", async () => {
      const orgA = await registerOrg(app, "RT TenantA Co");
      const orgB = await registerOrg(app, "RT TenantB Co");
      const cA = client(orgA.accessToken);
      const cB = client(orgB.accessToken);
      await Promise.all([waitConnect(cA), waitConnect(cB)]);

      const prA = await postPROk(app, orgA.accessToken);
      const eventForA = waitEvent(cA);
      const noneForB = waitNoEvent(cB);
      expect((await submitPR(app, orgA.accessToken, prA.id)).status).toBe(200);

      const evt = await eventForA;
      expect(evt.organizationId).toBe(orgA.organizationId);
      expect(await noneForB).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────
  // PUBLISH FAILURE / POST-COMMIT DISCIPLINE
  // ────────────────────────────────────────────────────────────
  describe("publish failure does not affect the committed business transaction", () => {
    it("a forced Socket.IO emission failure after commit still leaves the HTTP call, DB row, and AuditLog successful", async () => {
      const admin = await registerOrg(app, "RT PublishFailure Co");
      const pr = await postPROk(app, admin.accessToken);

      // Fake only the emission boundary (Phase F §32) — DomainEventsService's
      // own try/catch around `this.server.to(...).emit(...)` is real
      // production code; this proves it actually swallows a failure there
      // rather than letting it propagate into the caller's HTTP response.
      const gateway = app.get(RealtimeGateway) as unknown as { server: { to: (...args: unknown[]) => unknown } };
      const realServer = gateway.server;
      const spy = jest.spyOn(realServer, "to").mockImplementation(() => {
        throw new Error("simulated emission failure");
      });

      try {
        const res = await submitPR(app, admin.accessToken, pr.id);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe("UNDER_APPROVAL");

        const dbPr = await db.purchaseRequest.findUniqueOrThrow({ where: { id: pr.id } });
        expect(dbPr.status).toBe("UNDER_APPROVAL");

        const audits = await db.auditLog.findMany({ where: { entityType: "PurchaseRequest", entityId: pr.id, action: "PURCHASE_REQUEST_SUBMITTED" } });
        expect(audits).toHaveLength(1);
      } finally {
        spy.mockRestore();
      }
    });
  });

  // ────────────────────────────────────────────────────────────
  // FINAL LIFECYCLE ACCEPTANCE (§35)
  // ────────────────────────────────────────────────────────────
  describe("final workflow lifecycle acceptance", () => {
    it("create -> submit -> assign -> approve -> cancel: full audit + realtime history matches", async () => {
      const admin = await registerOrg(app, "RT Lifecycle Co");
      const employee = await inviteAndLogin(app, admin, "EMPLOYEE");
      const manager = await inviteAndLogin(app, admin, "PROCUREMENT_MANAGER");
      const c = client(admin.accessToken);
      await waitConnect(c);

      const collector = collectEvents(c, 4000);

      const pr = await postPROk(app, employee.accessToken);
      const submitRes = await submitOk(app, employee.accessToken, pr.id);
      const assignRes = await assignBuyer(app, manager.accessToken, pr.id, manager.userId);
      expect(assignRes.status).toBe(200);
      const approveRes = await approvePR(app, manager.accessToken, pr.id);
      expect(approveRes.status).toBe(200);
      const cancelRes = await cancelPR(app, manager.accessToken, pr.id);
      expect(cancelRes.status).toBe(200);

      expect(submitRes.status).toBe("UNDER_APPROVAL");
      expect(cancelRes.body.status).toBe("CANCELLED");
      expect(cancelRes.body.submittedAt).toBeTruthy();
      expect(cancelRes.body.cancelledAt).toBeTruthy();
      expect(cancelRes.body.cancelledByUserId).toBe(manager.userId);
      expect(cancelRes.body.assignedBuyerUserId).toBe(manager.userId);
      const approval = cancelRes.body.approval as Record<string, unknown>;
      expect(approval.status).toBe("APPROVED");
      const step = approval.step as Record<string, unknown>;
      expect(step.status).toBe("APPROVED");
      expect(step.decidedById).toBe(manager.userId);
      expect(step.decidedAt).toBeTruthy();

      const audits = await db.auditLog.findMany({
        where: { entityType: "PurchaseRequest", entityId: pr.id },
        orderBy: { createdAt: "asc" },
      });
      expect(audits.map((a) => a.action)).toEqual([
        "PURCHASE_REQUEST_CREATED",
        "PURCHASE_REQUEST_SUBMITTED",
        "PURCHASE_REQUEST_ASSIGNED",
        "PURCHASE_REQUEST_APPROVED",
        "PURCHASE_REQUEST_CANCELLED",
      ]);

      const events = await collector.done;
      const relevant = events.filter((e) => e.entityId === pr.id);
      expect(relevant.map((e) => e.eventType)).toEqual([
        "PURCHASE_REQUEST_SUBMITTED",
        "PURCHASE_REQUEST_ASSIGNED",
        "PURCHASE_REQUEST_APPROVED",
        "PURCHASE_REQUEST_CANCELLED",
      ]);
    });
  });
});
