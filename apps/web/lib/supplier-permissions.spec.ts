import type { UserRole } from "@top/types";
import {
  canChangeSupplierStatus,
  canCreateSupplier,
  canEditSupplier,
  canManageCategories,
  canManageSupplierCapabilities,
  canManageSupplierContacts,
  canRateSupplier,
  canViewCategories,
  canViewSuppliers,
} from "./supplier-permissions";

const ALL_ROLES: UserRole[] = ["ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST", "EMPLOYEE", "APPROVER", "SUPPLIER"];
const SUPPLIER_ROLES: UserRole[] = ["ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST"];
const MANAGER_ROLES: UserRole[] = ["ADMIN", "PROCUREMENT_MANAGER"];

function expectMatrix(fn: (role: UserRole) => boolean, allowed: UserRole[]) {
  for (const role of ALL_ROLES) {
    expect(fn(role)).toBe(allowed.includes(role));
  }
}

describe("supplier-permissions — full six-role matrix (Phase D §77)", () => {
  it("canViewSuppliers: ADMIN/MANAGER/SPECIALIST only — EMPLOYEE/APPROVER/SUPPLIER see nothing", () => {
    expectMatrix(canViewSuppliers, SUPPLIER_ROLES);
  });

  it("canCreateSupplier matches the read matrix", () => {
    expectMatrix(canCreateSupplier, SUPPLIER_ROLES);
  });

  it("canEditSupplier (general update) matches the read matrix", () => {
    expectMatrix(canEditSupplier, SUPPLIER_ROLES);
  });

  it("canChangeSupplierStatus: ADMIN/MANAGER only — SPECIALIST explicitly cannot", () => {
    expectMatrix(canChangeSupplierStatus, MANAGER_ROLES);
    expect(canChangeSupplierStatus("PROCUREMENT_SPECIALIST")).toBe(false);
  });

  it("canRateSupplier matches the read matrix (includes SPECIALIST)", () => {
    expectMatrix(canRateSupplier, SUPPLIER_ROLES);
  });

  it("canManageSupplierContacts matches the read matrix", () => {
    expectMatrix(canManageSupplierContacts, SUPPLIER_ROLES);
  });

  it("canManageSupplierCapabilities matches the read matrix", () => {
    expectMatrix(canManageSupplierCapabilities, SUPPLIER_ROLES);
  });

  it("canViewCategories matches the read matrix", () => {
    expectMatrix(canViewCategories, SUPPLIER_ROLES);
  });

  it("canManageCategories: ADMIN/MANAGER only — SPECIALIST can read but not manage", () => {
    expectMatrix(canManageCategories, MANAGER_ROLES);
    expect(canManageCategories("PROCUREMENT_SPECIALIST")).toBe(false);
  });

  it("EMPLOYEE cannot see internal Supplier Master in any capacity", () => {
    expect(canViewSuppliers("EMPLOYEE")).toBe(false);
    expect(canCreateSupplier("EMPLOYEE")).toBe(false);
    expect(canEditSupplier("EMPLOYEE")).toBe(false);
  });

  it("SUPPLIER role cannot see internal Supplier Master in any capacity", () => {
    expect(canViewSuppliers("SUPPLIER")).toBe(false);
    expect(canCreateSupplier("SUPPLIER")).toBe(false);
    expect(canEditSupplier("SUPPLIER")).toBe(false);
  });
});
