import { ExecutionContext, createParamDecorator } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/types/authenticated-request";

/** Injects the PortalContext PortalAuthGuard attached — never request.user, never the raw token (mirrors @CurrentUser()'s pattern for internal routes). */
export const PortalCtx = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  return request.portalContext;
});
