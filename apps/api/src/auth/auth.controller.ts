import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, Res, UnauthorizedException } from "@nestjs/common";
import type { Request, Response } from "express";
import { loadEnv } from "@top/config";
import { loginSchema, registerSchema, type LoginInput, type RegisterInput } from "@top/validation";
import type { CurrentUser as CurrentUserDto } from "@top/types";
import type { createTenantSafePrismaClient } from "@top/database";
import { Public } from "../common/decorators/public.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { TENANT_PRISMA } from "../database/database.module";
import type { AccessTokenClaims } from "../common/types/authenticated-request";
import { AuthService } from "./auth.service";

const REFRESH_COOKIE = "top_refresh_token";

@Controller("api/v1/auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(TENANT_PRISMA) private readonly db: ReturnType<typeof createTenantSafePrismaClient>
  ) {}

  @Public()
  @Post("register")
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    const result = await this.auth.register(body, clientIp(req));
    setRefreshCookie(res, result.refreshToken, result.refreshTokenExpiresAt);
    return { user: result.user, accessToken: result.accessToken };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post("login")
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    const result = await this.auth.login(body, clientIp(req));
    setRefreshCookie(res, result.refreshToken, result.refreshTokenExpiresAt);
    return { user: result.user, accessToken: result.accessToken };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post("refresh")
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!raw) throw new UnauthorizedException("Missing refresh token");
    const result = await this.auth.refresh(raw, clientIp(req));
    setRefreshCookie(res, result.refreshToken, result.refreshTokenExpiresAt);
    return { user: result.user, accessToken: result.accessToken };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post("logout")
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    await this.auth.logout(raw);
    clearRefreshCookie(res);
    return { success: true };
  }

  @Get("me")
  async me(@CurrentUser() claims: AccessTokenClaims): Promise<CurrentUserDto> {
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: claims.sub },
      include: { organization: true },
    });
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      organizationId: user.organizationId,
      organizationName: user.organization.name,
    };
  }
}

function clientIp(req: Request): string | null {
  const forwarded = req.headers["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
  return first?.trim() ?? req.socket.remoteAddress ?? null;
}

function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  const env = loadEnv();
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/v1/auth",
    expires: expiresAt,
  });
}

function clearRefreshCookie(res: Response): void {
  const env = loadEnv();
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/v1/auth",
  });
}
