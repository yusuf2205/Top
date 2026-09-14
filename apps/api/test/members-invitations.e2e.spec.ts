import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, uniqueEmail } from "./test-app";

async function registerOrg(app: INestApplication, orgName: string) {
  const email = uniqueEmail("admin");
  const password = "correct-horse-battery-staple";
  const res = await request(app.getHttpServer())
    .post("/api/v1/auth/register")
    .send({ organizationName: orgName, fullName: "Admin User", email, password });
  return { email, password, accessToken: res.body.accessToken as string, userId: res.body.user.id as string };
}

describe("Members + Invitations (RBAC, tenant isolation, last-admin protection)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("admin invites a member, member accepts, and can then log in with their assigned role", async () => {
    const admin = await registerOrg(app, "Invite Flow Co");
    const inviteeEmail = uniqueEmail("employee");

    const invite = await request(app.getHttpServer())
      .post("/api/v1/members/invitations")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ email: inviteeEmail, role: "EMPLOYEE" })
      .expect(201);
    const token = invite.body.rawToken as string;
    expect(token).toBeTruthy();

    const lookup = await request(app.getHttpServer()).get(`/api/v1/invitations/${token}`).expect(200);
    expect(lookup.body).toMatchObject({ email: inviteeEmail, role: "EMPLOYEE", organizationName: "Invite Flow Co" });

    await request(app.getHttpServer())
      .post(`/api/v1/invitations/${token}/accept`)
      .send({ fullName: "New Employee", password: "correct-horse-battery-staple" })
      .expect(200);

    // Accepting again with the same (now-consumed) token must fail.
    await request(app.getHttpServer())
      .post(`/api/v1/invitations/${token}/accept`)
      .send({ fullName: "New Employee", password: "correct-horse-battery-staple" })
      .expect(409);

    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: inviteeEmail, password: "correct-horse-battery-staple" })
      .expect(200);
    expect(login.body.user.role).toBe("EMPLOYEE");
  });

  it("a non-admin cannot invite members (403)", async () => {
    const admin = await registerOrg(app, "RBAC Deny Co");
    const employeeEmail = uniqueEmail("emp2");
    const invite = await request(app.getHttpServer())
      .post("/api/v1/members/invitations")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ email: employeeEmail, role: "EMPLOYEE" });
    const employeeLogin = await request(app.getHttpServer())
      .post(`/api/v1/invitations/${invite.body.rawToken}/accept`)
      .send({ fullName: "Employee Two", password: "correct-horse-battery-staple" })
      .then(() => request(app.getHttpServer()).post("/api/v1/auth/login").send({ email: employeeEmail, password: "correct-horse-battery-staple" }));

    await request(app.getHttpServer())
      .post("/api/v1/members/invitations")
      .set("Authorization", `Bearer ${employeeLogin.body.accessToken}`)
      .send({ email: uniqueEmail("blocked"), role: "EMPLOYEE" })
      .expect(403);
  });

  it("cannot demote or remove the last remaining admin", async () => {
    const admin = await registerOrg(app, "Last Admin Co");

    await request(app.getHttpServer())
      .patch(`/api/v1/members/${admin.userId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ role: "EMPLOYEE" })
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/api/v1/members/${admin.userId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .expect(403);
  });

  describe("Tenant isolation: Organization A must never see Organization B's data", () => {
    it("Org A cannot see Org B's members list", async () => {
      const orgA = await registerOrg(app, "Org A Isolation Co");
      const orgB = await registerOrg(app, "Org B Isolation Co");

      const membersOfA = await request(app.getHttpServer())
        .get("/api/v1/members")
        .set("Authorization", `Bearer ${orgA.accessToken}`)
        .expect(200);

      expect(membersOfA.body.every((m: { id: string }) => m.id !== orgB.userId)).toBe(true);
      expect(membersOfA.body.some((m: { id: string }) => m.id === orgA.userId)).toBe(true);
    });

    it("Org A admin cannot update or remove a User belonging to Org B, even by guessing their id", async () => {
      const orgA = await registerOrg(app, "Org A Attack Co");
      const orgB = await registerOrg(app, "Org B Victim Co");

      // Org B's own userId is real and known to us only because this is a test —
      // an attacker would have to guess/enumerate it. Either way it must not work.
      await request(app.getHttpServer())
        .patch(`/api/v1/members/${orgB.userId}`)
        .set("Authorization", `Bearer ${orgA.accessToken}`)
        .send({ role: "EMPLOYEE" })
        .expect(404);

      await request(app.getHttpServer())
        .delete(`/api/v1/members/${orgB.userId}`)
        .set("Authorization", `Bearer ${orgA.accessToken}`)
        .expect(404);

      // And Org B's admin account must be completely unaffected.
      const stillWorks = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ email: orgB.email, password: orgB.password })
        .expect(200);
      expect(stillWorks.body.user.role).toBe("ADMIN");
    });

    it("Org A cannot see or revoke Org B's pending invitations", async () => {
      const orgA = await registerOrg(app, "Org A Invite Isolation Co");
      const orgB = await registerOrg(app, "Org B Invite Isolation Co");

      const orgBInvite = await request(app.getHttpServer())
        .post("/api/v1/members/invitations")
        .set("Authorization", `Bearer ${orgB.accessToken}`)
        .send({ email: uniqueEmail("orgb-invitee"), role: "EMPLOYEE" })
        .expect(201);

      const orgAInvitations = await request(app.getHttpServer())
        .get("/api/v1/members/invitations")
        .set("Authorization", `Bearer ${orgA.accessToken}`)
        .expect(200);
      expect(orgAInvitations.body.some((i: { id: string }) => i.id === orgBInvite.body.invitation.id)).toBe(false);

      await request(app.getHttpServer())
        .delete(`/api/v1/members/invitations/${orgBInvite.body.invitation.id}`)
        .set("Authorization", `Bearer ${orgA.accessToken}`)
        .expect(404);
    });

    it("a JWT's organizationId cannot be overridden by anything client-supplied", async () => {
      const orgA = await registerOrg(app, "Org A No Override Co");
      const orgB = await registerOrg(app, "Org B No Override Co");

      // Attempt to smuggle Org B's id via body/query on an endpoint that takes
      // no such field — the server must ignore it entirely and act only on
      // the organizationId embedded in Org A's verified access token.
      const res = await request(app.getHttpServer())
        .get(`/api/v1/organizations/current?organizationId=${orgB.userId}`)
        .set("Authorization", `Bearer ${orgA.accessToken}`)
        .expect(200);
      expect(res.body.name).toBe("Org A No Override Co");
    });
  });
});
