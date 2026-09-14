import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, uniqueEmail } from "./test-app";

function extractRefreshCookie(res: request.Response): string {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  const cookie = raw?.find((c) => c.startsWith("top_refresh_token="));
  if (!cookie) throw new Error("No top_refresh_token cookie in response");
  return cookie.split(";")[0]; // "top_refresh_token=<value>"
}

describe("Auth flow (register → login → me → refresh → logout)", () => {
  let app: INestApplication;
  const email = uniqueEmail("owner");
  const password = "correct-horse-battery-staple";

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("registers a new organization + owner atomically", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ organizationName: "Acme Test Co", fullName: "Ada Owner", email, password })
      .expect(201);

    expect(res.body.user).toMatchObject({ email, role: "ADMIN" });
    expect(typeof res.body.accessToken).toBe("string");
    expect(extractRefreshCookie(res)).toContain("top_refresh_token=");
  });

  it("rejects registering the same email twice", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ organizationName: "Dup Co", fullName: "Dup", email, password })
      .expect(409);
  });

  it("logs in with correct credentials", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email, password })
      .expect(200);
    expect(res.body.user.email).toBe(email);
  });

  it("rejects a wrong password with a generic message (no user enumeration)", async () => {
    const wrongPassword = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email, password: "totally-wrong-password" })
      .expect(401);

    const noSuchUser = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: uniqueEmail("nobody"), password: "whatever12345" })
      .expect(401);

    expect(wrongPassword.body.message).toEqual(noSuchUser.body.message);
  });

  it("GET /auth/me requires a valid access token", async () => {
    await request(app.getHttpServer()).get("/api/v1/auth/me").expect(401);

    const login = await request(app.getHttpServer()).post("/api/v1/auth/login").send({ email, password });
    const res = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(res.body).toMatchObject({ email, role: "ADMIN", organizationName: "Acme Test Co" });
  });

  it("rotates the refresh token and rejects reuse of the old one", async () => {
    const login = await request(app.getHttpServer()).post("/api/v1/auth/login").send({ email, password });
    const firstRefreshCookie = extractRefreshCookie(login);

    const refreshed = await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .set("Cookie", firstRefreshCookie)
      .expect(200);
    expect(typeof refreshed.body.accessToken).toBe("string");
    const secondRefreshCookie = extractRefreshCookie(refreshed);
    expect(secondRefreshCookie).not.toEqual(firstRefreshCookie);

    // Reusing the now-rotated-away first token must fail — proves rotation +
    // reuse detection actually revokes, not just "issues a new one and moves on".
    await request(app.getHttpServer()).post("/api/v1/auth/refresh").set("Cookie", firstRefreshCookie).expect(401);
  });

  it("logout revokes the refresh token", async () => {
    const login = await request(app.getHttpServer()).post("/api/v1/auth/login").send({ email, password });
    const cookie = extractRefreshCookie(login);

    await request(app.getHttpServer()).post("/api/v1/auth/logout").set("Cookie", cookie).expect(200);
    await request(app.getHttpServer()).post("/api/v1/auth/refresh").set("Cookie", cookie).expect(401);
  });

  it("rejects a malformed registration payload (password too short)", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ organizationName: "X", fullName: "X", email: uniqueEmail("short"), password: "short" })
      .expect(400);
  });
});
