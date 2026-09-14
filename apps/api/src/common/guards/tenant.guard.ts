import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import type { AuthenticatedRequest } from "../types/authenticated-request";

/**
 * Defense-in-depth check (ARCHITECTURE.md §1.5 #4): runs after JwtAuthGuard,
 * before RolesGuard. The actual AsyncLocalStorage tenant context is
 * established by TenantContextInterceptor (interceptors run after guards
 * pass, wrapping the handler call) — this guard's job is only to fail fast
 * with a clear 403 if somehow no organizationId is present on an
 * authenticated route, rather than letting a later Prisma call fail with an
 * opaque "no tenant context" error.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user?.organizationId) {
      throw new ForbiddenException("No organization context");
    }
    return true;
  }
}
