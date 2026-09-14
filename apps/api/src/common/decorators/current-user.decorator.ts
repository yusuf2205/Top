import { ExecutionContext, createParamDecorator } from "@nestjs/common";
import type { AuthenticatedRequest } from "../types/authenticated-request";

/** Injects the verified access-token claims for the current request. Undefined on @Public() routes with no token. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  return request.user;
});
