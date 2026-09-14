import { ConflictException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { createSystemPrismaClient } from "@top/database";
import type { CurrentUser } from "@top/types";
import type { RegisterInput, LoginInput } from "@top/validation";
import { SYSTEM_PRISMA } from "../database/database.module";
import { PasswordService } from "../common/auth/password.service";
import { TokenService } from "../common/token/token.service";
import { AuditService } from "../common/audit/audit.service";

export interface AuthResult {
  user: CurrentUser;
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

type SystemDb = ReturnType<typeof createSystemPrismaClient>;

/**
 * Every method here runs BEFORE a tenant context exists (login/register are
 * how a session is established in the first place; refresh/logout identify
 * the user from an opaque token, not a JWT) — so this service is one of the
 * few sanctioned users of SYSTEM_PRISMA, per database/database.module.ts.
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(SYSTEM_PRISMA) private readonly db: SystemDb,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService
  ) {}

  async register(input: RegisterInput, ipAddress: string | null): Promise<AuthResult> {
    const existing = await this.db.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new ConflictException("An account with this email already exists");
    }

    const passwordHash = await this.passwords.hash(input.password);

    const { organization, user } = await this.db.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: { name: input.organizationName },
      });
      const user = await tx.user.create({
        data: {
          organizationId: organization.id,
          email: input.email,
          passwordHash,
          fullName: input.fullName,
          role: "ADMIN",
        },
      });
      return { organization, user };
    });

    await this.audit.log({
      organizationId: organization.id,
      userId: user.id,
      action: "ORGANIZATION_CREATED",
      entityType: "Organization",
      entityId: organization.id,
      newValue: { name: organization.name },
      ipAddress,
    });
    await this.audit.log({
      organizationId: organization.id,
      userId: user.id,
      action: "USER_REGISTERED",
      entityType: "User",
      entityId: user.id,
      newValue: { email: user.email, role: user.role },
      ipAddress,
    });

    return this.issueSession({ ...user, organizationName: organization.name }, ipAddress);
  }

  async login(input: LoginInput, ipAddress: string | null): Promise<AuthResult> {
    const user = await this.db.user.findUnique({
      where: { email: input.email },
      include: { organization: true },
    });

    // Same generic message whether the email doesn't exist, the account is
    // inactive, or the password is wrong — never let a client distinguish
    // these (prompt §27: don't allow user enumeration via login).
    const invalid = () => new UnauthorizedException("Invalid email or password");

    if (!user || !user.active) throw invalid();

    const passwordOk = await this.passwords.verify(user.passwordHash, input.password);
    if (!passwordOk) {
      await this.audit.log({
        organizationId: user.organizationId,
        userId: user.id,
        action: "USER_LOGIN_FAILED",
        entityType: "User",
        entityId: user.id,
        ipAddress,
      });
      throw invalid();
    }

    await this.db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log({
      organizationId: user.organizationId,
      userId: user.id,
      action: "USER_LOGIN",
      entityType: "User",
      entityId: user.id,
      ipAddress,
    });

    return this.issueSession({ ...user, organizationName: user.organization.name }, ipAddress);
  }

  async refresh(rawToken: string, ipAddress: string | null): Promise<AuthResult> {
    const tokenHash = this.tokens.hashToken(rawToken);
    const stored = await this.db.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { include: { organization: true } } },
    });

    if (!stored) throw new UnauthorizedException("Invalid refresh token");

    if (stored.revokedAt) {
      // Reuse of an already-rotated-away token: treat as possible theft and
      // kill every other live session for this user, not just this one.
      await this.db.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException("Refresh token has already been used");
    }

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException("Refresh token has expired");
    }

    if (!stored.user.active) {
      throw new UnauthorizedException("Account is disabled");
    }

    const next = this.tokens.generateRefreshToken();
    await this.db.$transaction(async (tx) => {
      const newToken = await tx.refreshToken.create({
        data: { userId: stored.userId, tokenHash: next.hash, expiresAt: next.expiresAt, ipAddress },
      });
      await tx.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date(), replacedByTokenId: newToken.id },
      });
    });

    const accessToken = this.tokens.signAccessToken(stored.user);
    return {
      user: toCurrentUser({ ...stored.user, organizationName: stored.user.organization.name }),
      accessToken,
      refreshToken: next.raw,
      refreshTokenExpiresAt: next.expiresAt,
    };
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const tokenHash = this.tokens.hashToken(rawToken);
    const stored = await this.db.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.revokedAt) return; // idempotent

    await this.db.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
    await this.audit.log({
      organizationId: (await this.db.user.findUnique({ where: { id: stored.userId } }))?.organizationId ?? "",
      userId: stored.userId,
      action: "USER_LOGOUT",
      entityType: "User",
      entityId: stored.userId,
    });
  }

  private async issueSession(
    user: { id: string; organizationId: string; role: import("@top/database").UserRole; email: string; fullName: string; organizationName: string },
    ipAddress: string | null
  ): Promise<AuthResult> {
    const accessToken = this.tokens.signAccessToken(user);
    const refresh = this.tokens.generateRefreshToken();
    await this.db.refreshToken.create({
      data: { userId: user.id, tokenHash: refresh.hash, expiresAt: refresh.expiresAt, ipAddress },
    });
    return {
      user: toCurrentUser(user),
      accessToken,
      refreshToken: refresh.raw,
      refreshTokenExpiresAt: refresh.expiresAt,
    };
  }
}

function toCurrentUser(user: {
  id: string;
  email: string;
  fullName: string;
  role: import("@top/database").UserRole;
  organizationId: string;
  organizationName: string;
}): CurrentUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    organizationId: user.organizationId,
    organizationName: user.organizationName,
  };
}
