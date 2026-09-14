import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { UserRole } from "@top/database";
import { ROLES_KEY } from "../decorators/roles.decorator";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import type { AuthenticatedRequest } from "../types/authenticated-request";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // No @Roles() on the route: any authenticated, tenant-scoped user may
    // proceed (e.g. GET /auth/me, GET /organizations/current). Explicit
    // per-action restrictions come from ARCHITECTURE.md §6 RBAC Matrix.
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const role = request.user?.role;
    if (!role || !requiredRoles.includes(role)) {
      throw new ForbiddenException("You do not have permission to perform this action");
    }
    return true;
  }
}
