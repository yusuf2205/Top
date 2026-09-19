import type { UserRole } from "@top/types";

/**
 * UX-only visibility helpers for the internal RFQ workspace — same discipline
 * as pr-permissions.ts/supplier-permissions.ts: the backend (RolesGuard on
 * every /api/v1/rfqs route, Phase C §14) is the real authorization authority.
 * Hiding a button here never substitutes for that.
 *
 * M3.3 locked matrix (Phase C §14/Architecture Revision 1 §5/§65): flat RBAC,
 * no ownership-based visibility — ADMIN/PROCUREMENT_MANAGER/
 * PROCUREMENT_SPECIALIST get every action, EMPLOYEE/APPROVER/SUPPLIER get
 * none. Unlike pr-permissions.ts there is no per-status/per-actor narrowing
 * to encode here — state-machine gating (DRAFT vs SENT vs CLOSED vs
 * CANCELLED) is handled separately by the calling page/component reading
 * `rfq.status`, not by these role checks.
 */
const RFQ_ROLES: UserRole[] = ["ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST"];

export function canViewRfqs(role: UserRole): boolean {
  return RFQ_ROLES.includes(role);
}

export function canCreateRfq(role: UserRole): boolean {
  return RFQ_ROLES.includes(role);
}

export function canEditRfqDraft(role: UserRole): boolean {
  return RFQ_ROLES.includes(role);
}

export function canSendRfq(role: UserRole): boolean {
  return RFQ_ROLES.includes(role);
}

export function canCloseRfq(role: UserRole): boolean {
  return RFQ_ROLES.includes(role);
}

export function canCancelRfq(role: UserRole): boolean {
  return RFQ_ROLES.includes(role);
}

/** M3.4 Phase D §1 — invite/reissue/revoke/internal-quote-read share the exact same RBAC matrix as every other RFQ action (backend `@Roles(...)` on all four routes, apps/api/src/rfqs/rfqs.controller.ts). */
export function canManagePortalAccess(role: UserRole): boolean {
  return RFQ_ROLES.includes(role);
}
