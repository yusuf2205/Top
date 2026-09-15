import { Inject, Injectable } from "@nestjs/common";
import { SYSTEM_PRISMA } from "../../database/database.module";
import type { createSystemPrismaClient, Prisma } from "@top/database";

/**
 * The M1-relevant subset of ARCHITECTURE.md's audit events (prompt §25).
 * NEVER pass password/passwordHash/access-token/refresh-token/invitation-raw-token
 * as oldValue/newValue — see each call site.
 */
export type AuditAction =
  | "USER_REGISTERED"
  | "USER_LOGIN"
  | "USER_LOGIN_FAILED"
  | "USER_LOGOUT"
  | "ORGANIZATION_CREATED"
  | "ORGANIZATION_UPDATED"
  | "INVITATION_CREATED"
  | "INVITATION_ACCEPTED"
  | "INVITATION_REVOKED"
  | "MEMBER_ROLE_CHANGED"
  | "MEMBER_REMOVED"
  | "PRODUCT_CATEGORY_CREATED"
  | "PRODUCT_CATEGORY_UPDATED"
  | "PRODUCT_CREATED"
  | "PRODUCT_UPDATED"
  | "PRODUCT_ARCHIVED";

interface AuditLogParams {
  organizationId: string;
  userId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  ipAddress?: string | null;
}

/**
 * Writes go through SYSTEM_PRISMA, not the tenant-safe client: audit events
 * happen both inside an authenticated request (context available) and outside
 * one (register/login, before any session exists) — organizationId is always
 * supplied explicitly by the caller (which already knows it from a verified
 * source), so bypassing the tenant-context requirement here is deliberate,
 * not a hole — see database/database.module.ts.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(SYSTEM_PRISMA) private readonly db: ReturnType<typeof createSystemPrismaClient>) {}

  async log(params: AuditLogParams): Promise<void> {
    await this.db.auditLog.create({
      data: {
        organizationId: params.organizationId,
        userId: params.userId ?? null,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        oldValue: (params.oldValue ?? undefined) as Prisma.InputJsonValue | undefined,
        newValue: (params.newValue ?? undefined) as Prisma.InputJsonValue | undefined,
        ipAddress: params.ipAddress ?? null,
      },
    });
  }
}
