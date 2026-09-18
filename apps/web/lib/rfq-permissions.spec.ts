import type { UserRole } from "@top/types";
import { canCancelRfq, canCloseRfq, canCreateRfq, canEditRfqDraft, canSendRfq, canViewRfqs } from "./rfq-permissions";

const ALL_ROLES: UserRole[] = ["ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST", "EMPLOYEE", "APPROVER", "SUPPLIER"];
const RFQ_ROLES: UserRole[] = ["ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST"];

function expectMatrix(fn: (role: UserRole) => boolean, allowed: UserRole[]) {
  for (const role of ALL_ROLES) {
    expect(fn(role)).toBe(allowed.includes(role));
  }
}

describe("rfq-permissions — full six-role matrix (Phase D §96)", () => {
  it("canViewRfqs: ADMIN/MANAGER/SPECIALIST only", () => {
    expectMatrix(canViewRfqs, RFQ_ROLES);
  });

  it("canCreateRfq matches the view matrix", () => {
    expectMatrix(canCreateRfq, RFQ_ROLES);
  });

  it("canEditRfqDraft matches the view matrix", () => {
    expectMatrix(canEditRfqDraft, RFQ_ROLES);
  });

  it("canSendRfq matches the view matrix", () => {
    expectMatrix(canSendRfq, RFQ_ROLES);
  });

  it("canCloseRfq matches the view matrix", () => {
    expectMatrix(canCloseRfq, RFQ_ROLES);
  });

  it("canCancelRfq matches the view matrix", () => {
    expectMatrix(canCancelRfq, RFQ_ROLES);
  });

  it("EMPLOYEE/APPROVER/SUPPLIER cannot see the internal RFQ workspace in any capacity", () => {
    for (const role of ["EMPLOYEE", "APPROVER", "SUPPLIER"] as UserRole[]) {
      expect(canViewRfqs(role)).toBe(false);
      expect(canCreateRfq(role)).toBe(false);
      expect(canEditRfqDraft(role)).toBe(false);
      expect(canSendRfq(role)).toBe(false);
      expect(canCloseRfq(role)).toBe(false);
      expect(canCancelRfq(role)).toBe(false);
    }
  });
});
