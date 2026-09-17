import type { UserRole } from "@top/types";

/**
 * UX-only visibility helpers for Supplier Master — same discipline as
 * pr-permissions.ts: the backend (RolesGuard on each Supplier/Category
 * controller route, Revision 1 §8) is the real authorization authority.
 * Hiding a button here never substitutes for that.
 *
 * Locked matrix (M3.2 Phase D §5):
 *   READ / CREATE / GENERAL UPDATE / RATING / CONTACTS / CAPABILITIES:
 *     ADMIN, PROCUREMENT_MANAGER, PROCUREMENT_SPECIALIST
 *   STATUS: ADMIN, PROCUREMENT_MANAGER
 *   CATEGORY READ: ADMIN, PROCUREMENT_MANAGER, PROCUREMENT_SPECIALIST
 *   CATEGORY CREATE/UPDATE: ADMIN, PROCUREMENT_MANAGER
 */

const SUPPLIER_ROLES: UserRole[] = ["ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST"];
const MANAGER_ROLES: UserRole[] = ["ADMIN", "PROCUREMENT_MANAGER"];

export function canViewSuppliers(role: UserRole): boolean {
  return SUPPLIER_ROLES.includes(role);
}

export function canCreateSupplier(role: UserRole): boolean {
  return SUPPLIER_ROLES.includes(role);
}

export function canEditSupplier(role: UserRole): boolean {
  return SUPPLIER_ROLES.includes(role);
}

export function canChangeSupplierStatus(role: UserRole): boolean {
  return MANAGER_ROLES.includes(role);
}

export function canRateSupplier(role: UserRole): boolean {
  return SUPPLIER_ROLES.includes(role);
}

export function canManageSupplierContacts(role: UserRole): boolean {
  return SUPPLIER_ROLES.includes(role);
}

export function canManageSupplierCapabilities(role: UserRole): boolean {
  return SUPPLIER_ROLES.includes(role);
}

export function canViewCategories(role: UserRole): boolean {
  return SUPPLIER_ROLES.includes(role);
}

export function canManageCategories(role: UserRole): boolean {
  return MANAGER_ROLES.includes(role);
}
