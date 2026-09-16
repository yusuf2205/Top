import type { PurchaseRequestSummary, UserRole } from "@top/types";

/**
 * UX-only visibility helpers — centralized here so no component re-derives
 * `role === "ADMIN" || role === "PROCUREMENT_MANAGER"` by hand. The backend
 * (RolesGuard + PurchaseRequestsService's own ownership/state checks) is the
 * real authorization authority; hiding a button here never substitutes for
 * that, it only avoids showing an action the API would reject anyway.
 */
export interface Actor {
  id: string;
  role: UserRole;
}

const ORG_WIDE_EDIT_ROLES: UserRole[] = ["ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST"];

/** Applies to header edit, add/update/remove item, and submit — all identically ownership-scoped (Phase D/E `visibilityWhere`). */
function isEditor(actor: Actor, pr: Pick<PurchaseRequestSummary, "requesterId">): boolean {
  if (ORG_WIDE_EDIT_ROLES.includes(actor.role)) return true;
  return actor.role === "EMPLOYEE" && pr.requesterId === actor.id;
}

export function canEditPurchaseRequest(actor: Actor, pr: Pick<PurchaseRequestSummary, "status" | "requesterId">): boolean {
  return pr.status === "DRAFT" && isEditor(actor, pr);
}

export function canSubmitPurchaseRequest(
  actor: Actor,
  pr: Pick<PurchaseRequestSummary, "status" | "requesterId" | "items">
): boolean {
  return pr.status === "DRAFT" && isEditor(actor, pr) && pr.items.length > 0;
}

export function canApprovePurchaseRequest(actor: Actor, pr: Pick<PurchaseRequestSummary, "status" | "approval">): boolean {
  if (pr.status !== "UNDER_APPROVAL" || pr.approval?.step?.status !== "PENDING") return false;
  if (actor.role === "ADMIN" || actor.role === "PROCUREMENT_MANAGER") return true;
  // APPROVER only for the exact step they're assigned to — M3.1 never sets
  // assignedUserId (Phase E §9 dormancy), so this is structurally almost
  // always false today, kept for forward compatibility.
  return actor.role === "APPROVER" && pr.approval.step.assignedUserId === actor.id;
}

/** Same gate as approve — reject and approve are the same decision point, just opposite outcomes. */
export function canRejectPurchaseRequest(actor: Actor, pr: Pick<PurchaseRequestSummary, "status" | "approval">): boolean {
  return canApprovePurchaseRequest(actor, pr);
}

export function canCancelPurchaseRequest(actor: Actor, pr: Pick<PurchaseRequestSummary, "status" | "requesterId">): boolean {
  // Deliberately NOT isEditor() — PROCUREMENT_SPECIALIST may edit/submit a
  // DRAFT but may never cancel one (Phase E §19), a narrower actor set than
  // edit/submit's.
  if (pr.status === "DRAFT") {
    return actor.role === "ADMIN" || actor.role === "PROCUREMENT_MANAGER" || (actor.role === "EMPLOYEE" && pr.requesterId === actor.id);
  }
  if (pr.status === "APPROVED") return actor.role === "ADMIN" || actor.role === "PROCUREMENT_MANAGER";
  return false;
}

const ASSIGNABLE_STATUSES: PurchaseRequestSummary["status"][] = ["SUBMITTED", "UNDER_APPROVAL", "APPROVED"];

export function canAssignBuyer(actor: Actor, pr: Pick<PurchaseRequestSummary, "status">): boolean {
  return (actor.role === "ADMIN" || actor.role === "PROCUREMENT_MANAGER") && ASSIGNABLE_STATUSES.includes(pr.status);
}

/** Eligible assign-buyer targets — ADMIN is deliberately never a valid target, only a valid actor (Phase E §26). */
export const ELIGIBLE_BUYER_ROLES: UserRole[] = ["PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST"];
