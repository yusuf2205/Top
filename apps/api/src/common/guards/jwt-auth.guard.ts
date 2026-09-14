import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { TokenService } from "../token/token.service";
import type { AuthenticatedRequest } from "../types/authenticated-request";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedException("Missing access token");
    }

    // Verify even on @Public() routes when a token IS present, so downstream
    // code can still see req.user if it wants to (none currently do) — but
    // never require it there.
    try {
      request.user = this.tokenService.verifyAccessToken(token);
    } catch (err) {
      if (isPublic) return true;
      throw err;
    }

    return true;
  }
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  return scheme === "Bearer" && value ? value : null;
}
