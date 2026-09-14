import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createTestApp, extractRefreshCookie, uniqueEmail } from "./test-app";

async function registerOrg(app: INestApplication, orgName: string) {
  const email = uniqueEmail("sec");
  const password = "correct-horse-battery-staple";
  const res = await request(app.getHttpServer())
    .post("/api/v1/auth/register")
    .send({ organizationName: orgName, fullName: "Sec Admin", email, password });
  return { email, password, accessToken: res.body.accessToken as string, userId: res.body.user.id as string };
}

describe("M1.1 Security Hardening", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("JWT manipulation", () => {
    it("rejects a malformed/garbage token", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/auth/me")
        .set("Authorization", "Bearer not.a.real.token")
        .expect(401);
    });

    it("rejects a token signed with a different secret (tampered signature)", async () => {
      const forged = jwt.sign(
        { sub: "attacker", organizationId: "attacker-org", role: "ADMIN", email: "x@x.test" },
        "wrong-secret-the-server-does-not-know",
        { algorithm: "HS256", expiresIn: "15m" }
      );
      await request(app.getHttpServer()).get("/api/v1/auth/me").set("Authorization", `Bearer ${forged}`).expect(401);
    });

    it("rejects an alg:none token (unsigned) even with attacker-chosen claims", async () => {
      const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
      const payload = Buffer.from(
        JSON.stringify({ sub: "attacker", organizationId: "attacker-org", role: "ADMIN", email: "x@x.test" })
      ).toString("base64url");
      const noneToken = `${header}.${payload}.`;
      await request(app.getHttpServer())
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${noneToken}`)
        .expect(401);
    });

    it("rejects an expired access token", async () => {
      // Same secret pattern as token.service.spec.ts's test env — the test
      // app boots with these via process.env (see jest.config.js / CI env).
      const secret = process.env.JWT_ACCESS_SECRET;
      if (!secret) throw new Error("JWT_ACCESS_SECRET not set in test environment");
      const expired = jwt.sign(
        { sub: "someone", organizationId: "some-org", role: "ADMIN", email: "x@x.test" },
        secret,
        { algorithm: "HS256", expiresIn: -10 } // already expired 10s ago
      );
      await request(app.getHttpServer()).get("/api/v1/auth/me").set("Authorization", `Bearer ${expired}`).expect(401);
    });
  });

  describe("Refresh token edge cases", () => {
    it("rejects a completely random/unknown refresh token", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/auth/refresh")
        .set("Cookie", "top_refresh_token=0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000")
        .expect(401);
    });

    it("rejects refresh with no cookie at all", async () => {
      await request(app.getHttpServer()).post("/api/v1/auth/refresh").expect(401);
    });

    it("concurrent refresh with the same token: exactly one wins, none corrupt the session", async () => {
      const org = await registerOrg(app, "Concurrent Refresh Co");
      const login = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ email: org.email, password: org.password });
      const raw = extractRefreshCookie(login.headers["set-cookie"] as unknown as string[] | undefined);

      const [a, b] = await Promise.all([
        request(app.getHttpServer()).post("/api/v1/auth/refresh").set("Cookie", raw),
        request(app.getHttpServer()).post("/api/v1/auth/refresh").set("Cookie", raw),
      ]);
      const statuses = [a.status, b.status].sort();
      // Exactly one of the two racing requests succeeds; the other must be
      // rejected (401), never both silently "succeeding" with divergent tokens.
      expect(statuses).toEqual([200, 401]);
    });
  });

  describe("Mass assignment / injection via request body", () => {
    it("register: a client-supplied role/organizationId in the body is silently ignored, not honored", async () => {
      const email = uniqueEmail("massassign");
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/register")
        .send({
          organizationName: "Mass Assignment Co",
          fullName: "Attacker",
          email,
          password: "correct-horse-battery-staple",
          role: "SUPER_ADMIN",
          organizationId: "some-other-org-id",
          passwordHash: "already-hashed-value",
          active: true,
        })
        .expect(201);
      expect(res.body.user.role).toBe("ADMIN"); // always ADMIN for a fresh org, never client-chosen
      expect(res.body.user.organizationId).not.toBe("some-other-org-id");
    });

    it("invite: a client-supplied organizationId/invitedById in the body is ignored", async () => {
      const admin = await registerOrg(app, "Invite Mass Assignment Co");
      const otherOrg = await registerOrg(app, "Other Org For Injection Co");
      const targetEmail = uniqueEmail("injected-invitee");

      const res = await request(app.getHttpServer())
        .post("/api/v1/members/invitations")
        .set("Authorization", `Bearer ${admin.accessToken}`)
        .send({
          email: targetEmail,
          role: "EMPLOYEE",
          organizationId: otherOrg.userId, // attempt to plant the invitation in another org
          invitedById: otherOrg.userId,
        })
        .expect(201);

      // The invitation must belong to the ADMIN's own org, not the injected one.
      const asOtherOrg = await request(app.getHttpServer())
        .get("/api/v1/members/invitations")
        .set("Authorization", `Bearer ${otherOrg.accessToken}`)
        .expect(200);
      expect(asOtherOrg.body.some((i: { id: string }) => i.id === res.body.invitation.id)).toBe(false);
    });
  });

  describe("Role escalation", () => {
    it("a non-admin cannot escalate their own role via PATCH /members/:userId", async () => {
      const admin = await registerOrg(app, "Self Escalation Co");
      const employeeEmail = uniqueEmail("escalator");
      const invite = await request(app.getHttpServer())
        .post("/api/v1/members/invitations")
        .set("Authorization", `Bearer ${admin.accessToken}`)
        .send({ email: employeeEmail, role: "EMPLOYEE" });
      await request(app.getHttpServer())
        .post(`/api/v1/invitations/${invite.body.rawToken}/accept`)
        .send({ fullName: "Escalator", password: "correct-horse-battery-staple" });
      const employeeLogin = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ email: employeeEmail, password: "correct-horse-battery-staple" });

      await request(app.getHttpServer())
        .patch(`/api/v1/members/${employeeLogin.body.user.id}`)
        .set("Authorization", `Bearer ${employeeLogin.body.accessToken}`)
        .send({ role: "ADMIN" })
        .expect(403);
    });

    it("rejects an invalid/unknown role value instead of silently accepting it", async () => {
      const admin = await registerOrg(app, "Invalid Role Co");
      await request(app.getHttpServer())
        .patch(`/api/v1/members/${admin.userId}`)
        .set("Authorization", `Bearer ${admin.accessToken}`)
        .send({ role: "SUPER_ADMIN" })
        .expect(400);
    });
  });

  describe("Disabled user lifecycle", () => {
    it("a disabled (soft-removed) user cannot log in or refresh, even with correct credentials/valid token", async () => {
      const admin = await registerOrg(app, "Disable User Co");
      const employeeEmail = uniqueEmail("tobedisabled");
      const password = "correct-horse-battery-staple";
      const invite = await request(app.getHttpServer())
        .post("/api/v1/members/invitations")
        .set("Authorization", `Bearer ${admin.accessToken}`)
        .send({ email: employeeEmail, role: "EMPLOYEE" });
      await request(app.getHttpServer())
        .post(`/api/v1/invitations/${invite.body.rawToken}/accept`)
        .send({ fullName: "To Be Disabled", password });
      const employeeLogin = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ email: employeeEmail, password });
      const employeeRefreshCookie = extractRefreshCookie(employeeLogin.headers["set-cookie"] as unknown as string[] | undefined);

      await request(app.getHttpServer())
        .delete(`/api/v1/members/${employeeLogin.body.user.id}`)
        .set("Authorization", `Bearer ${admin.accessToken}`)
        .expect(200);

      // Can no longer log in with correct credentials.
      await request(app.getHttpServer()).post("/api/v1/auth/login").send({ email: employeeEmail, password }).expect(401);

      // Their existing (still cryptographically valid, unexpired) refresh
      // token is blocked at the next refresh — bounds exposure to the
      // remaining lifetime of their last-issued access token (documented
      // accepted trade-off, see M1.1 report).
      await request(app.getHttpServer())
        .post("/api/v1/auth/refresh")
        .set("Cookie", employeeRefreshCookie)
        .expect(401);
    });
  });

  describe("Invitation expiry", () => {
    it("rejects an invitation token that does not exist (never issued)", async () => {
      await request(app.getHttpServer()).get("/api/v1/invitations/0000000000000000000000000000000000000000000000000000000000000000").expect(404);
    });
  });

  describe("CORS", () => {
    it("does not reflect an arbitrary Origin — only allow-listed origins get credentials support", async () => {
      const res = await request(app.getHttpServer())
        .options("/api/v1/auth/login")
        .set("Origin", "https://evil.example.com")
        .set("Access-Control-Request-Method", "POST");
      expect(res.headers["access-control-allow-origin"]).not.toBe("https://evil.example.com");
      expect(res.headers["access-control-allow-origin"]).not.toBe("*");
    });
  });
});
