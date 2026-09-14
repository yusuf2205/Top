import { SetMetadata } from "@nestjs/common";
import type { UserRole } from "@top/database";

export const ROLES_KEY = "roles";

/**
 * Restricts an endpoint to the given roles — enforced by RolesGuard.
 * Per ARCHITECTURE.md §6 RBAC Matrix: default is deny for business actions,
 * but an endpoint with no @Roles() at all (e.g. GET /auth/me) is reachable by
 * any authenticated, tenant-scoped user — RolesGuard only restricts when this
 * metadata is explicitly present.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
