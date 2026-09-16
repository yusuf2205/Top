import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import jwt from "jsonwebtoken";
import { io, type Socket as ClientSocket } from "socket.io-client";
import { createSystemPrismaClient } from "@top/database";
import { REALTIME_EVENT_NAME, organizationRoom, type DomainEvent } from "@top/types";
import { createTestApp, uniqueEmail } from "./test-app";

/**
 * Realtime Foundation E2E suite. Boots a real Nest app AND makes it actually
 * listen on a real TCP port (`app.listen(0)`) — every other *.e2e.spec.ts
 * file in this repo only calls `app.init()` and drives it through
 * supertest's in-memory agent, which is enough for HTTP but not for a real
 * Socket.IO handshake (socket.io-client needs an actual URL to connect to).
 * This is deliberately isolated to this one file — no other test file's
 * setup is touched, and no product code depends on this file listening.
 */

interface OrgContext {
  email: string;
  accessToken: string;
  userId: string;
  organizationId: string;
}

async function registerOrg(app: INestApplication, orgName: string): Promise<OrgContext> {
  const email = uniqueEmail("rt");
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
    delete: (url: string) => request(app.getHttpServer()).delete(url).set("Authorization", `Bearer ${token}`),
  };
}

async function createProduct(app: INestApplication, token: string): Promise<{ id: string; sku: string }> {
  const sku = `SKU-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await authed(app, token)
    .post("/api/v1/products")
    .send({ sku, name: "Realtime Test Product", productType: "MATERIAL", baseUomCode: "KG", trackingMode: "QUANTITY" });
  if (res.status !== 201) throw new Error(`createProduct failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { id: res.body.id as string, sku: res.body.sku as string };
}

async function createWarehouse(app: INestApplication, token: string): Promise<{ id: string }> {
  const res = await authed(app, token)
    .post("/api/v1/warehouses")
    .send({ code: `WH-${Math.random().toString(36).slice(2, 8).toUpperCase()}`, name: "Realtime Test Warehouse" });
  if (res.status !== 201) throw new Error(`createWarehouse failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { id: res.body.id as string };
}

async function postMovement(app: INestApplication, token: string, body: Record<string, unknown>) {
  return authed(app, token).post("/api/v1/stock-movements").send(body);
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

function waitConnectError(client: ClientSocket, timeoutMs = 5000): Promise<Error> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("expected connect_error, got neither")), timeoutMs);
    client.once("connect_error", (err: Error) => {
      clearTimeout(timer);
      resolve(err);
    });
    client.once("connect", () => {
      clearTimeout(timer);
      reject(new Error("expected connect_error but the socket connected"));
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

/** Negative-assertion helper: waits a bounded time and resolves null if nothing arrived — used to prove an event does NOT reach a given socket. */
function waitNoEvent(client: ClientSocket, waitMs = 1000): Promise<DomainEvent | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), waitMs);
    client.once(REALTIME_EVENT_NAME, (evt: DomainEvent) => {
      clearTimeout(timer);
      resolve(evt);
    });
  });
}

describe("Realtime Foundation", () => {
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
    for (const client of openClients.splice(0)) {
      client.removeAllListeners();
      client.close();
    }
  });

  function client(token?: string): ClientSocket {
    const c = io(baseUrl, {
      autoConnect: false,
      transports: ["websocket"],
      reconnection: false,
      auth: token !== undefined ? { token } : {},
    });
    openClients.push(c);
    return c;
  }

  // ────────────────────────────────────────────────────────────
  // Socket auth
  // ────────────────────────────────────────────────────────────
  describe("socket authentication", () => {
    it("1. an authenticated socket connects", async () => {
      const admin = await registerOrg(app, "Realtime Connect Co");
      const c = client(admin.accessToken);
      await expect(waitConnect(c)).resolves.toBeUndefined();
      expect(c.connected).toBe(true);
    });

    it("rejects a connection with no token at all", async () => {
      const c = client(undefined);
      const err = await waitConnectError(c);
      expect(err).toBeInstanceOf(Error);
    });

    it("2. rejects an invalid/malformed JWT", async () => {
      const c = client("not.a.real.token");
      await expect(waitConnectError(c)).resolves.toBeInstanceOf(Error);
    });

    it("3. rejects an expired JWT (same secret, valid shape, expiresIn in the past)", async () => {
      const secret = process.env.JWT_ACCESS_SECRET;
      if (!secret) throw new Error("JWT_ACCESS_SECRET not set in test environment");
      const admin = await registerOrg(app, "Realtime Expired Co");
      const expired = jwt.sign(
        { sub: admin.userId, organizationId: admin.organizationId, role: "ADMIN", email: admin.email },
        secret,
        { algorithm: "HS256", expiresIn: -10 }
      );
      const c = client(expired);
      await expect(waitConnectError(c)).resolves.toBeInstanceOf(Error);
    });

    it("4. rejects a disabled user's still-cryptographically-valid token", async () => {
      const admin = await registerOrg(app, "Realtime Disabled Co");
      const member = await inviteAndLogin(app, admin, "EMPLOYEE");

      const removeRes = await authed(app, admin.accessToken).delete(`/api/v1/members/${member.userId}`);
      expect(removeRes.status).toBe(200);

      const c = client(member.accessToken); // token itself is still unexpired and correctly signed
      await expect(waitConnectError(c)).resolves.toBeInstanceOf(Error);
    });

    it("16. disconnect/reconnect works", async () => {
      const admin = await registerOrg(app, "Realtime Reconnect Co");
      const c = client(admin.accessToken);
      await waitConnect(c);
      expect(c.connected).toBe(true);

      c.disconnect();
      // give the client a tick to flip its own connected flag
      await new Promise((r) => setTimeout(r, 50));
      expect(c.connected).toBe(false);

      c.connect();
      await waitConnect(c);
      expect(c.connected).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────
  // Tenant isolation / room model
  // ────────────────────────────────────────────────────────────
  describe("tenant isolation", () => {
    it("5/10/11/12/13/14. own-organization socket receives a correctly-shaped event", async () => {
      const admin = await registerOrg(app, "Realtime OwnOrg Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const c = client(admin.accessToken);
      await waitConnect(c);

      const eventPromise = waitEvent(c);
      const res = await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "5.000" }],
      });
      expect(res.status).toBe(201);

      const evt = await eventPromise;
      expect(evt.eventType).toBe("STOCK_MOVEMENT_CREATED");
      expect(evt.entityType).toBe("StockMovement");
      expect(evt.entityId).toBe(res.body.id);
      expect(evt.organizationId).toBe(admin.organizationId); // 10: from server identity
      expect(evt.actorUserId).toBe(admin.userId); // 11: from server identity, never client body
      expect(typeof evt.eventId).toBe("string");
      expect(evt.eventId.length).toBeGreaterThan(0); // 12
      expect(new Date(evt.occurredAt).toString()).not.toBe("Invalid Date"); // 13
      expect(evt.version).toBe(1); // 14
      expect(evt.payload).toEqual({ type: "RECEIPT" }); // small, compact — no full row
    });

    it("6. does not receive another organization's event", async () => {
      const orgA = await registerOrg(app, "Realtime TenantA Co");
      const orgB = await registerOrg(app, "Realtime TenantB Co");
      const productB = await createProduct(app, orgB.accessToken);
      const whB = await createWarehouse(app, orgB.accessToken);

      const cA = client(orgA.accessToken);
      await waitConnect(cA);
      const noneForA = waitNoEvent(cA);

      const res = await postMovement(app, orgB.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: productB.id, warehouseId: whB.id, uomCode: "KG", quantity: "5.000" }],
      });
      expect(res.status).toBe(201);

      expect(await noneForA).toBeNull();
    });

    it("7. a client cannot force-join a foreign organization room (no client-controlled room API exists)", async () => {
      const orgA = await registerOrg(app, "Realtime NoForceJoin A Co");
      const orgB = await registerOrg(app, "Realtime NoForceJoin B Co");
      const productB = await createProduct(app, orgB.accessToken);
      const whB = await createWarehouse(app, orgB.accessToken);

      const cA = client(orgA.accessToken);
      await waitConnect(cA);
      // Attempt every plausible client-side "join a room" shape — the
      // gateway has zero @SubscribeMessage handlers, so all of these are
      // simply unhandled Socket.IO events (a documented no-op), never an
      // actual room join.
      cA.emit("join", organizationRoom(orgB.organizationId));
      cA.emit("subscribe", { room: organizationRoom(orgB.organizationId) });
      cA.emit("join-room", organizationRoom(orgB.organizationId));

      const noneForA = waitNoEvent(cA);
      const res = await postMovement(app, orgB.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: productB.id, warehouseId: whB.id, uomCode: "KG", quantity: "5.000" }],
      });
      expect(res.status).toBe(201);
      expect(await noneForA).toBeNull();
    });

    it("18. multiple clients in the same organization all receive the same authorized event", async () => {
      const admin = await registerOrg(app, "Realtime MultiClient Co");
      const member = await inviteAndLogin(app, admin, "EMPLOYEE");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);

      const cAdmin = client(admin.accessToken);
      const cMember = client(member.accessToken);
      await Promise.all([waitConnect(cAdmin), waitConnect(cMember)]);

      const [evtAdmin, evtMember] = await Promise.all([
        waitEvent(cAdmin),
        waitEvent(cMember),
        postMovement(app, admin.accessToken, {
          type: "RECEIPT",
          lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "3.000" }],
        }),
      ]);
      expect(evtAdmin.eventId).toBe(evtMember.eventId); // same event, delivered to both
    });
  });

  // ────────────────────────────────────────────────────────────
  // Commit boundary / idempotency
  // ────────────────────────────────────────────────────────────
  describe("commit boundary", () => {
    it("8. a successful StockMovement eventually produces a realtime event", async () => {
      const admin = await registerOrg(app, "Realtime Success Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const c = client(admin.accessToken);
      await waitConnect(c);

      const eventPromise = waitEvent(c);
      await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "1.000" }],
      });
      await expect(eventPromise).resolves.toMatchObject({ eventType: "STOCK_MOVEMENT_CREATED" });
    });

    it("9. a failed StockMovement transaction produces NO success event", async () => {
      const admin = await registerOrg(app, "Realtime Rollback Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const c = client(admin.accessToken);
      await waitConnect(c);

      const noEvent = waitNoEvent(c);
      const res = await postMovement(app, admin.accessToken, {
        type: "ISSUE", // nothing was ever received — guaranteed insufficient stock
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "1.000" }],
      });
      expect(res.status).toBe(409);
      expect(await noEvent).toBeNull();
    });

    it("idempotent replay does not produce a second event", async () => {
      const admin = await registerOrg(app, "Realtime IdemNoDup Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const c = client(admin.accessToken);
      await waitConnect(c);

      const body = {
        type: "RECEIPT",
        idempotencyKey: "realtime-idem-key-1",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "1.000" }],
      };

      const firstEvent = waitEvent(c);
      const first = await postMovement(app, admin.accessToken, body);
      expect(first.status).toBe(201);
      await firstEvent;

      const noSecondEvent = waitNoEvent(c);
      const replay = await postMovement(app, admin.accessToken, body);
      expect(replay.status).toBe(201);
      expect(replay.body.id).toBe(first.body.id);
      expect(await noSecondEvent).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────
  // Payload safety / second example event type
  // ────────────────────────────────────────────────────────────
  describe("payload safety and the second example event type", () => {
    it("15. payload never contains secrets, tokens, or password material", async () => {
      const admin = await registerOrg(app, "Realtime PayloadSafety Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const c = client(admin.accessToken);
      await waitConnect(c);

      const eventPromise = waitEvent(c);
      await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "1.000" }],
      });
      const evt = await eventPromise;

      const serialized = JSON.stringify(evt).toLowerCase();
      for (const forbidden of ["password", "passwordhash", "accesstoken", "refreshtoken", "secret", "authorization"]) {
        expect(serialized).not.toContain(forbidden);
      }
      expect(Object.keys(evt.payload)).toEqual(["type"]); // compact, identifiers-and-a-discriminator only
    });

    it("PRODUCT_CREATED fires for a non-stock mutation, proving commit -> event generalizes", async () => {
      const admin = await registerOrg(app, "Realtime ProductEvent Co");
      const c = client(admin.accessToken);
      await waitConnect(c);

      const eventPromise = waitEvent(c);
      const product = await createProduct(app, admin.accessToken);
      const evt = await eventPromise;

      expect(evt.eventType).toBe("PRODUCT_CREATED");
      expect(evt.entityType).toBe("Product");
      expect(evt.entityId).toBe(product.id);
      expect(evt.organizationId).toBe(admin.organizationId);
      expect(evt.actorUserId).toBe(admin.userId);
      expect(evt.payload).toMatchObject({ sku: product.sku, productType: "MATERIAL" });
    });
  });

  // ────────────────────────────────────────────────────────────
  // Reconciliation — REST stays authoritative regardless of realtime delivery
  // ────────────────────────────────────────────────────────────
  describe("reconciliation", () => {
    it("17. REST remains authoritative after a disconnect/reconnect, even for a mutation made while disconnected", async () => {
      const admin = await registerOrg(app, "Realtime Reconcile Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const c = client(admin.accessToken);
      await waitConnect(c);
      c.disconnect();
      await new Promise((r) => setTimeout(r, 50));

      // A movement happens while this client is disconnected — it must not
      // receive this event (no buffering/replay in this foundation), but the
      // movement itself is still fully committed and REST-readable.
      const res = await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "9.000" }],
      });
      expect(res.status).toBe(201);

      c.connect();
      await waitConnect(c);
      // No ghost/replayed event for the movement that happened while offline.
      const noReplay = await waitNoEvent(c, 500);
      expect(noReplay).toBeNull();

      // But REST is fully authoritative regardless.
      const detail = await authed(app, admin.accessToken).get(`/api/v1/stock-movements/${res.body.id}`);
      expect(detail.status).toBe(200);
      expect(Number(detail.body.lines[0].quantity)).toBe(9);
    });
  });
});
