import { Inject, Injectable } from "@nestjs/common";
import { SYSTEM_PRISMA, type TenantTransactionClient } from "../../database/database.module";
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
  | "PRODUCT_ARCHIVED"
  | "UOM_CONVERSION_CREATED"
  | "UOM_CONVERSION_UPDATED"
  | "UOM_CONVERSION_DELETED"
  | "MATERIAL_SPECIFICATION_SET"
  | "MATERIAL_SPECIFICATION_DELETED"
  | "WAREHOUSE_CREATED"
  | "WAREHOUSE_UPDATED"
  | "LOCATION_CREATED"
  | "LOCATION_UPDATED"
  | "STOCK_BALANCE_CREATED"
  | "STOCK_BALANCE_UPDATED"
  | "STOCK_LOT_CREATED"
  | "STOCK_LOT_UPDATED"
  | "STOCK_LOT_PLACEMENT_CREATED"
  | "STOCK_LOT_PLACEMENT_UPDATED"
  | "STOCK_PIECE_CREATED"
  | "STOCK_MOVEMENT_CREATED"
  // M3.1 Phase B (Architecture Gate Revision 1, Decision 5) — action
  // strings only, added ahead of the service layer that will call them
  // (Phase E/F); no AuditService.log(...) call sites added in this phase.
  | "PURCHASE_REQUEST_CREATED"
  | "PURCHASE_REQUEST_UPDATED"
  | "PURCHASE_REQUEST_ITEM_ADDED"
  | "PURCHASE_REQUEST_ITEM_UPDATED"
  | "PURCHASE_REQUEST_ITEM_REMOVED"
  | "PURCHASE_REQUEST_SUBMITTED"
  | "PURCHASE_REQUEST_APPROVED"
  | "PURCHASE_REQUEST_REJECTED"
  | "PURCHASE_REQUEST_CANCELLED"
  | "PURCHASE_REQUEST_ASSIGNED"
  // M3.2 (Architecture Gate Revision 1, Decision R31/D10).
  | "SUPPLIER_CREATED"
  | "SUPPLIER_UPDATED"
  | "SUPPLIER_STATUS_CHANGED"
  | "SUPPLIER_RATING_CHANGED"
  | "SUPPLIER_CONTACT_ADDED"
  | "SUPPLIER_CONTACT_UPDATED"
  | "SUPPLIER_CONTACT_ARCHIVED"
  | "SUPPLIER_CAPABILITY_ADDED"
  | "SUPPLIER_CAPABILITY_REMOVED"
  | "CATEGORY_CREATED"
  | "CATEGORY_UPDATED";

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
 * Writes go through SYSTEM_PRISMA by default, not the tenant-safe client:
 * audit events happen both inside an authenticated request (context
 * available) and outside one (register/login, before any session exists) —
 * organizationId is always supplied explicitly by the caller (which already
 * knows it from a verified source), so bypassing the tenant-context
 * requirement here is deliberate, not a hole — see database/database.module.ts.
 *
 * M2.5 (Architecture Gate Revision 1 §22, Phase E): optional `tx` parameter.
 * When supplied, the write executes via that transaction client instead of
 * the injected SYSTEM_PRISMA instance, so the audit row participates in the
 * SAME Postgres transaction as the business mutation that caused it — a
 * rollback of the movement necessarily rolls back this audit row too (see
 * the Phase E "audit written in same transaction rolls back with business
 * mutation" test). Every existing call site (auth/members/products/
 * warehouses/stock, ~30 in total) is unaffected: the parameter is optional
 * and defaults to the exact prior behavior.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(SYSTEM_PRISMA) private readonly db: ReturnType<typeof createSystemPrismaClient>) {}

  async log(params: AuditLogParams, tx?: TenantTransactionClient): Promise<void> {
    const data = {
      organizationId: params.organizationId,
      userId: params.userId ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      oldValue: (params.oldValue ?? undefined) as Prisma.InputJsonValue | undefined,
      newValue: (params.newValue ?? undefined) as Prisma.InputJsonValue | undefined,
      ipAddress: params.ipAddress ?? null,
    };
    // Two explicit branches rather than `(tx ?? this.db).auditLog.create(...)`:
    // unifying TenantTransactionClient | SystemPrismaClient into one call
    // target sends TypeScript into an "excessive stack depth" comparison
    // between their two very different generic client shapes (confirmed
    // empirically in Phase F). Branching keeps each call independently,
    // simply typed.
    if (tx) {
      await tx.auditLog.create({ data });
    } else {
      await this.db.auditLog.create({ data });
    }
  }
}
