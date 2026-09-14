import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { createSystemPrismaClient, createTenantSafePrismaClient, UserRole } from "@top/database";
import type { AcceptInvitationInput, InviteMemberInput } from "@top/validation";
import type { OrganizationMember, PendingInvitation } from "@top/types";
import { SYSTEM_PRISMA, TENANT_PRISMA } from "../database/database.module";
import { PasswordService } from "../common/auth/password.service";
import { TokenService } from "../common/token/token.service";
import { AuditService } from "../common/audit/audit.service";

type TenantDb = ReturnType<typeof createTenantSafePrismaClient>;
type SystemDb = ReturnType<typeof createSystemPrismaClient>;

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

@Injectable()
export class MembersService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantDb,
    @Inject(SYSTEM_PRISMA) private readonly systemDb: SystemDb,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService
  ) {}

  async list(organizationId: string): Promise<OrganizationMember[]> {
    const users = await this.db.user.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
    });
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      role: u.role,
      active: u.active,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
    }));
  }

  async listPendingInvitations(organizationId: string): Promise<PendingInvitation[]> {
    const invitations = await this.db.invitation.findMany({
      where: { organizationId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
    return invitations.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      status: i.status,
      expiresAt: i.expiresAt.toISOString(),
      createdAt: i.createdAt.toISOString(),
    }));
  }

  /**
   * Returns the raw invitation link. There is no email delivery in M1 (SMTP_*
   * env vars are optional/typically unset in this deployment) — the inviting
   * Admin copies the link and sends it themselves. See M1 implementation
   * report "Known limitations".
   */
  async invite(
    organizationId: string,
    invitedById: string,
    input: InviteMemberInput
  ): Promise<{ invitation: PendingInvitation; rawToken: string }> {
    const existingUser = await this.systemDb.user.findUnique({ where: { email: input.email } });
    if (existingUser) {
      throw new ConflictException("A user with this email already exists");
    }
    const existingInvite = await this.db.invitation.findFirst({
      where: { organizationId, email: input.email, status: "PENDING" },
    });
    if (existingInvite) {
      throw new ConflictException("An invitation is already pending for this email");
    }

    const { raw, hash } = this.tokens.generateOpaqueToken();
    const invitation = await this.db.invitation.create({
      data: {
        organizationId,
        email: input.email,
        role: input.role,
        tokenHash: hash,
        invitedById,
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      },
    });

    await this.audit.log({
      organizationId,
      userId: invitedById,
      action: "INVITATION_CREATED",
      entityType: "Invitation",
      entityId: invitation.id,
      newValue: { email: invitation.email, role: invitation.role },
    });

    return {
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        expiresAt: invitation.expiresAt.toISOString(),
        createdAt: invitation.createdAt.toISOString(),
      },
      rawToken: raw,
    };
  }

  async revokeInvitation(organizationId: string, invitationId: string, actingUserId: string): Promise<void> {
    const invitation = await this.db.invitation.findFirst({ where: { id: invitationId, organizationId } });
    if (!invitation) throw new NotFoundException("Invitation not found");
    if (invitation.status !== "PENDING") throw new ConflictException("Invitation is not pending");

    await this.db.invitation.update({ where: { id: invitationId }, data: { status: "REVOKED" } });
    await this.audit.log({
      organizationId,
      userId: actingUserId,
      action: "INVITATION_REVOKED",
      entityType: "Invitation",
      entityId: invitationId,
    });
  }

  /** Public lookup (no session) — used to render the accept-invitation page before the user has an account. */
  async getInvitationByToken(rawToken: string) {
    const invitation = await this.findValidInvitationByToken(rawToken);
    const organization = await this.systemDb.organization.findUniqueOrThrow({
      where: { id: invitation.organizationId },
    });
    return { email: invitation.email, role: invitation.role, organizationName: organization.name };
  }

  /** Public accept (no session yet) — creates the User; caller then redirects to /login. */
  async acceptInvitation(rawToken: string, input: AcceptInvitationInput): Promise<void> {
    const invitation = await this.findValidInvitationByToken(rawToken);

    const existingUser = await this.systemDb.user.findUnique({ where: { email: invitation.email } });
    if (existingUser) {
      throw new ConflictException("A user with this email already exists");
    }

    const passwordHash = await this.passwords.hash(input.password);
    const user = await this.systemDb.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          organizationId: invitation.organizationId,
          email: invitation.email,
          passwordHash,
          fullName: input.fullName,
          role: invitation.role,
        },
      });
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: "ACCEPTED", acceptedAt: new Date() },
      });
      return user;
    });

    await this.audit.log({
      organizationId: invitation.organizationId,
      userId: user.id,
      action: "INVITATION_ACCEPTED",
      entityType: "Invitation",
      entityId: invitation.id,
      newValue: { userId: user.id },
    });
  }

  async updateRole(
    organizationId: string,
    targetUserId: string,
    newRole: UserRole,
    actingUserId: string
  ): Promise<void> {
    const target = await this.db.user.findFirst({ where: { id: targetUserId, organizationId } });
    if (!target) throw new NotFoundException("Member not found");

    if (target.role === "ADMIN" && newRole !== "ADMIN") {
      await this.assertNotLastAdmin(organizationId, targetUserId);
    }

    await this.db.user.update({ where: { id: targetUserId }, data: { role: newRole } });
    await this.audit.log({
      organizationId,
      userId: actingUserId,
      action: "MEMBER_ROLE_CHANGED",
      entityType: "User",
      entityId: targetUserId,
      oldValue: { role: target.role },
      newValue: { role: newRole },
    });
  }

  /** Soft-delete, matching ARCHITECTURE.md §7 `DELETE /api/v1/users/:id (Admin, soft-delete)`. */
  async remove(organizationId: string, targetUserId: string, actingUserId: string): Promise<void> {
    const target = await this.db.user.findFirst({ where: { id: targetUserId, organizationId } });
    if (!target) throw new NotFoundException("Member not found");

    if (target.role === "ADMIN") {
      await this.assertNotLastAdmin(organizationId, targetUserId);
    }

    await this.db.user.update({ where: { id: targetUserId }, data: { active: false } });
    await this.audit.log({
      organizationId,
      userId: actingUserId,
      action: "MEMBER_REMOVED",
      entityType: "User",
      entityId: targetUserId,
    });
  }

  private async assertNotLastAdmin(organizationId: string, excludingUserId: string): Promise<void> {
    const otherActiveAdmins = await this.db.user.count({
      where: { organizationId, role: "ADMIN", active: true, id: { not: excludingUserId } },
    });
    if (otherActiveAdmins === 0) {
      throw new ForbiddenException("An organization must always have at least one administrator");
    }
  }

  private async findValidInvitationByToken(rawToken: string) {
    const tokenHash = this.tokens.hashToken(rawToken);
    const invitation = await this.systemDb.invitation.findUnique({ where: { tokenHash } });
    if (!invitation) throw new NotFoundException("Invitation not found");
    if (invitation.status !== "PENDING") throw new ConflictException("Invitation is no longer valid");
    if (invitation.expiresAt < new Date()) {
      await this.systemDb.invitation.update({ where: { id: invitation.id }, data: { status: "EXPIRED" } });
      throw new ConflictException("Invitation has expired");
    }
    return invitation;
  }
}
