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
 * Routes with no authenticated user (public routes) pass through unwrapped —
 * any accidental tenant-scoped query there will correctly throw
 * "No tenant context set" (fail closed), which is exactly what should happen.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const organizationId = request.user?.organizationId;

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
