import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { of } from "rxjs";
import { getTenantContextOrNull } from "@top/database";
import { TenantContextInterceptor } from "./tenant-context.interceptor";
import type { AuthenticatedRequest } from "../types/authenticated-request";

function contextFor(request: Partial<AuthenticatedRequest>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

/** Captures the tenant context observed at the moment `next.handle()` is invoked. */
function observingHandler(): { handler: CallHandler; observed: () => string | null } {
  let observed: string | null = null;
  const handler: CallHandler = {
    handle: () => {
      observed = getTenantContextOrNull()?.organizationId ?? null;
      return of("ok");
    },
  };
  return { handler, observed: () => observed };
}

describe("TenantContextInterceptor — M3.4 Phase B additive portalContext fallback (Revision 1 §31/§45)", () => {
  const interceptor = new TenantContextInterceptor();

  it("wraps with request.user.organizationId when present (existing internal-JWT behavior, unchanged)", (done) => {
    const { handler, observed } = observingHandler();
    interceptor.intercept(contextFor({ user: { sub: "u1", organizationId: "org-internal", role: "ADMIN", email: "a@b.com" } }), handler).subscribe(() => {
      expect(observed()).toBe("org-internal");
      done();
    });
  });

  it("falls back to request.portalContext.organizationId when request.user is absent (new M3.4 behavior)", (done) => {
    const { handler, observed } = observingHandler();
    interceptor
      .intercept(
        contextFor({
          portalContext: { organizationId: "org-portal", rfqId: "r1", rfqSupplierId: "rs1", supplierId: "s1", tokenHash: "h1" },
        }),
        handler
      )
      .subscribe(() => {
        expect(observed()).toBe("org-portal");
        done();
      });
  });

  it("prefers request.user.organizationId over portalContext when both are somehow present", (done) => {
    const { handler, observed } = observingHandler();
    interceptor
      .intercept(
        contextFor({
          user: { sub: "u1", organizationId: "org-internal", role: "ADMIN", email: "a@b.com" },
          portalContext: { organizationId: "org-portal", rfqId: "r1", rfqSupplierId: "rs1", supplierId: "s1", tokenHash: "h1" },
        }),
        handler
      )
      .subscribe(() => {
        expect(observed()).toBe("org-internal");
        done();
      });
  });

  it("passes through with NO tenant context (fail-closed) when neither request.user nor request.portalContext is present", (done) => {
    const { handler, observed } = observingHandler();
    interceptor.intercept(contextFor({}), handler).subscribe(() => {
      expect(observed()).toBeNull();
      done();
    });
  });
});
