process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.S3_ENDPOINT ??= "http://localhost:9000";
process.env.S3_ACCESS_KEY ??= "test";
process.env.S3_SECRET_KEY ??= "test";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-at-least-32-characters-long";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-at-least-32-characters-long";
process.env.PORTAL_TOKEN_SECRET ??= "test-portal-secret-at-least-32-characters-long";

import { UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { ExecutionContext } from "@nestjs/common";
import { PortalAuthGuard } from "./portal-auth.guard";
import { TokenService } from "../common/token/token.service";

function contextWithHeader(authorization: string | undefined): ExecutionContext {
  const request: { headers: { authorization?: string }; portalContext?: unknown } = { headers: { authorization } };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const RFQ_SUPPLIER_ROW = {
  id: "rfq-supplier-1",
  rfqId: "rfq-1",
  supplierId: "supplier-1",
  tokenExpiresAt: new Date(Date.now() + 60_000),
  rfq: { organizationId: "org-1" },
};

describe("PortalAuthGuard", () => {
  const tokens = new TokenService(new JwtService({}));
  const { raw } = tokens.generateOpaqueToken();
  const rawHash = tokens.hashToken(raw);

  function guardWith(findUniqueResult: unknown) {
    const findUnique = jest.fn().mockResolvedValue(findUniqueResult);
    const systemDb = { rFQSupplier: { findUnique } } as never;
    return { guard: new PortalAuthGuard(systemDb, tokens), findUnique };
  }

  it("rejects a missing Authorization header", async () => {
    const { guard } = guardWith(null);
    await expect(guard.canActivate(contextWithHeader(undefined))).rejects.toThrow(UnauthorizedException);
  });

  it("rejects a non-Bearer scheme", async () => {
    const { guard } = guardWith(null);
    await expect(guard.canActivate(contextWithHeader(`Basic ${raw}`))).rejects.toThrow(UnauthorizedException);
  });

  it("rejects an empty Bearer value", async () => {
    const { guard } = guardWith(null);
    await expect(guard.canActivate(contextWithHeader("Bearer "))).rejects.toThrow(UnauthorizedException);
  });

  it("rejects an unknown token (no matching RFQSupplier row)", async () => {
    const { guard, findUnique } = guardWith(null);
    await expect(guard.canActivate(contextWithHeader(`Bearer ${raw}`))).rejects.toThrow(UnauthorizedException);
    expect(findUnique).toHaveBeenCalledWith({
      where: { portalTokenHash: rawHash },
      select: expect.any(Object),
    });
  });

  it("rejects an expired token", async () => {
    const { guard } = guardWith({ ...RFQ_SUPPLIER_ROW, tokenExpiresAt: new Date(Date.now() - 1000) });
    await expect(guard.canActivate(contextWithHeader(`Bearer ${raw}`))).rejects.toThrow(UnauthorizedException);
  });

  it("rejects a row whose tokenExpiresAt is null (revoked)", async () => {
    const { guard } = guardWith({ ...RFQ_SUPPLIER_ROW, tokenExpiresAt: null });
    await expect(guard.canActivate(contextWithHeader(`Bearer ${raw}`))).rejects.toThrow(UnauthorizedException);
  });

  it("all rejection paths throw the identical generic message (no failure-reason leakage)", async () => {
    const cases = [undefined, `Basic ${raw}`, "Bearer "];
    const messages: string[] = [];
    for (const header of cases) {
      const { guard } = guardWith(null);
      try {
        await guard.canActivate(contextWithHeader(header));
      } catch (err) {
        messages.push((err as UnauthorizedException).message);
      }
    }
    const { guard: expiredGuard } = guardWith({ ...RFQ_SUPPLIER_ROW, tokenExpiresAt: new Date(Date.now() - 1000) });
    try {
      await expiredGuard.canActivate(contextWithHeader(`Bearer ${raw}`));
    } catch (err) {
      messages.push((err as UnauthorizedException).message);
    }
    expect(new Set(messages).size).toBe(1);
  });

  it("accepts a valid token and populates request.portalContext with exactly the expected fields", async () => {
    const { guard } = guardWith(RFQ_SUPPLIER_ROW);
    const request: { headers: { authorization: string }; portalContext?: unknown } = {
      headers: { authorization: `Bearer ${raw}` },
    };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(request.portalContext).toEqual({
      organizationId: "org-1",
      rfqId: "rfq-1",
      rfqSupplierId: "rfq-supplier-1",
      supplierId: "supplier-1",
      tokenHash: rawHash,
    });
  });

  it("never attaches the raw token anywhere it writes — portalContext carries only the hash", async () => {
    // request.headers.authorization legitimately DOES contain the raw token
    // (the client sent it there; scrubbing the original request object isn't
    // the guard's job or this test's concern). What matters is that the
    // guard's OWN addition — request.portalContext — never carries the raw
    // value anywhere, only its hash.
    const { guard } = guardWith(RFQ_SUPPLIER_ROW);
    const request: { headers: { authorization: string }; portalContext?: unknown } = {
      headers: { authorization: `Bearer ${raw}` },
    };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;

    await guard.canActivate(context);

    const serializedPortalContext = JSON.stringify(request.portalContext);
    expect(serializedPortalContext).not.toContain(raw);
  });

  it("looks up by hash, never by the raw token value", async () => {
    const { guard, findUnique } = guardWith(RFQ_SUPPLIER_ROW);
    await guard.canActivate(contextWithHeader(`Bearer ${raw}`));
    const calledWith = findUnique.mock.calls[0][0];
    expect(calledWith.where.portalTokenHash).toBe(rawHash);
    expect(calledWith.where.portalTokenHash).not.toBe(raw);
  });

  it("never includes the raw token in a thrown error message (§35 — no raw-token log/error leakage)", async () => {
    const { guard } = guardWith(null);
    let caught: unknown;
    try {
      await guard.canActivate(contextWithHeader(`Bearer ${raw}`));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnauthorizedException);
    expect((caught as UnauthorizedException).message).not.toContain(raw);
    expect(JSON.stringify(caught)).not.toContain(raw);
  });

  it("uses a bounded select — no Quote/RFQItem/Supplier-contact/other-supplier fields requested", async () => {
    const { guard, findUnique } = guardWith(RFQ_SUPPLIER_ROW);
    await guard.canActivate(contextWithHeader(`Bearer ${raw}`));
    const calledWith = findUnique.mock.calls[0][0];
    expect(calledWith.select).toEqual({
      id: true,
      rfqId: true,
      supplierId: true,
      tokenExpiresAt: true,
      rfq: { select: { organizationId: true } },
    });
  });
});
