import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable } from "rxjs";
import { runWithTenantContext } from "@top/database";
import type { AuthenticatedRequest } from "../types/authenticated-request";

/**
 * Registered globally (see app.module.ts) — runs after all guards pass, wraps
 * the controller handler call (and everything it awaits: services, Prisma
 * queries) in the AsyncLocalStorage tenant context that packages/database's
 * Prisma Client Extension reads from. This is the actual enforcement point;
 * JwtAuthGuard/TenantGuard only validate that organizationId is present.
 *
 * Routes with no authenticated user AND no portal context pass through
 * unwrapped — any accidental tenant-scoped query there will correctly throw
 * "No tenant context set" (fail closed), which is exactly what should happen.
 *
 * M3.4 Supplier Portal Phase B (Architecture Revision 1 §31/§45, empirically
 * verified — see portal/portal-tenant-context-order.spec.ts): NestJS's
 * request lifecycle runs the ENTIRE guards phase (global APP_GUARD providers
 * AND any controller-/route-level `@UseGuards()`) to completion before the
 * interceptors phase begins, regardless of "global vs local" registration —
 * that distinction only affects ordering WITHIN the guards phase. This means
 * a controller-level `PortalAuthGuard` (applied via `@UseGuards()` on the
 * future portal controller) reliably populates `request.portalContext`
 * before this global interceptor ever runs, for every request it handles.
 * `request.user?.organizationId` is checked first and always wins if
 * present — an authenticated internal request's tenant resolution is
 * byte-for-byte unchanged from before this addition. `portalContext` is
 * only ever consulted as a fallback, and only becomes possible at all once
 * PortalAuthGuard has actually resolved a valid token — there is no
 * unauthenticated fallback path, so fail-closed tenant semantics are
 * preserved exactly (Phase B §50).
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const organizationId = request.user?.organizationId ?? request.portalContext?.organizationId;

    if (!organizationId) {
      return next.handle();
    }

    return new Observable((subscriber) => {
      runWithTenantContext({ organizationId }, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}
