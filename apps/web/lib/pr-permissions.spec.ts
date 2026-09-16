import type { PurchaseRequestSummary } from "@top/types";
import {
  canApprovePurchaseRequest,
  canAssignBuyer,
  canCancelPurchaseRequest,
  canEditPurchaseRequest,
  canRejectPurchaseRequest,
  canSubmitPurchaseRequest,
  type Actor,
} from "./pr-permissions";

const EMPLOYEE_ID = "employee-1";
const OTHER_EMPLOYEE_ID = "employee-2";

function pr(overrides: Partial<PurchaseRequestSummary> = {}): PurchaseRequestSummary {
  return {
    id: "pr-1",
    requestNumber: "PR-2026-000001",
    requesterId: EMPLOYEE_ID,
    departmentId: null,
    categoryId: null,
    status: "DRAFT",
    priority: "NORMAL",
    requiredDate: null,
    reason: null,
    estimatedBudget: null,
    currency: "UZS",
    assignedBuyerUserId: null,
    submittedAt: null,
    cancelledAt: null,
    cancelledByUserId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    items: [],
    approval: null,
    ...overrides,
  };
}

const actor = (id: string, role: Actor["role"]): Actor => ({ id, role });

describe("pr-permissions — edit/submit", () => {
  it("org-wide roles can edit any DRAFT; EMPLOYEE only their own", () => {
    expect(canEditPurchaseRequest(actor("x", "ADMIN"), pr())).toBe(true);
    expect(canEditPurchaseRequest(actor("x", "PROCUREMENT_MANAGER"), pr())).toBe(true);
    expect(canEditPurchaseRequest(actor("x", "PROCUREMENT_SPECIALIST"), pr())).toBe(true);
    expect(canEditPurchaseRequest(actor(EMPLOYEE_ID, "EMPLOYEE"), pr())).toBe(true);
    expect(canEditPurchaseRequest(actor(OTHER_EMPLOYEE_ID, "EMPLOYEE"), pr())).toBe(false);
    expect(canEditPurchaseRequest(actor("x", "APPROVER"), pr())).toBe(false);
    expect(canEditPurchaseRequest(actor("x", "SUPPLIER"), pr())).toBe(false);
  });

  it("cannot edit outside DRAFT", () => {
    expect(canEditPurchaseRequest(actor("x", "ADMIN"), pr({ status: "UNDER_APPROVAL" }))).toBe(false);
  });

  it("submit requires at least one item, even for an otherwise-authorized actor", () => {
    expect(canSubmitPurchaseRequest(actor("x", "ADMIN"), pr({ items: [] }))).toBe(false);
    expect(canSubmitPurchaseRequest(actor("x", "ADMIN"), pr({ items: [{} as never] }))).toBe(true);
  });
});

describe("pr-permissions — approve/reject", () => {
  const underApprovalPending = pr({
    status: "UNDER_APPROVAL",
    approval: {
      status: "PENDING",
      completedAt: null,
      step: { status: "PENDING", stepOrder: 1, approverRole: "PROCUREMENT_MANAGER", assignedUserId: null, decidedById: null, decidedAt: null, comment: null },
    },
  });

  it("ADMIN/MANAGER can decide; SPECIALIST/EMPLOYEE/SUPPLIER cannot", () => {
    expect(canApprovePurchaseRequest(actor("x", "ADMIN"), underApprovalPending)).toBe(true);
    expect(canApprovePurchaseRequest(actor("x", "PROCUREMENT_MANAGER"), underApprovalPending)).toBe(true);
    expect(canApprovePurchaseRequest(actor("x", "PROCUREMENT_SPECIALIST"), underApprovalPending)).toBe(false);
    expect(canApprovePurchaseRequest(actor("x", "EMPLOYEE"), underApprovalPending)).toBe(false);
    expect(canApprovePurchaseRequest(actor("x", "SUPPLIER"), underApprovalPending)).toBe(false);
    expect(canRejectPurchaseRequest(actor("x", "ADMIN"), underApprovalPending)).toBe(true);
  });

  it("APPROVER action visibility respects assignedUserId exactly", () => {
    expect(canApprovePurchaseRequest(actor("approver-1", "APPROVER"), underApprovalPending)).toBe(false); // unassigned step

    const assignedToMe = pr({
      status: "UNDER_APPROVAL",
      approval: {
        status: "PENDING",
        completedAt: null,
        step: { status: "PENDING", stepOrder: 1, approverRole: "PROCUREMENT_MANAGER", assignedUserId: "approver-1", decidedById: null, decidedAt: null, comment: null },
      },
    });
    expect(canApprovePurchaseRequest(actor("approver-1", "APPROVER"), assignedToMe)).toBe(true);
    expect(canApprovePurchaseRequest(actor("approver-2", "APPROVER"), assignedToMe)).toBe(false);
  });

  it("no decision action once already decided (not PENDING) or PR not UNDER_APPROVAL", () => {
    expect(canApprovePurchaseRequest(actor("x", "ADMIN"), pr({ status: "DRAFT" }))).toBe(false);
    const alreadyApproved = pr({
      status: "APPROVED",
      approval: {
        status: "APPROVED",
        completedAt: new Date().toISOString(),
        step: { status: "APPROVED", stepOrder: 1, approverRole: "PROCUREMENT_MANAGER", assignedUserId: null, decidedById: "x", decidedAt: new Date().toISOString(), comment: null },
      },
    });
    expect(canApprovePurchaseRequest(actor("x", "ADMIN"), alreadyApproved)).toBe(false);
    expect(canRejectPurchaseRequest(actor("x", "ADMIN"), alreadyApproved)).toBe(false);
  });
});

describe("pr-permissions — cancel (rejected/cancelled/under-approval immutability)", () => {
  it("DRAFT: ADMIN/MANAGER always, EMPLOYEE only own, SPECIALIST/APPROVER/SUPPLIER never", () => {
    expect(canCancelPurchaseRequest(actor("x", "ADMIN"), pr())).toBe(true);
    expect(canCancelPurchaseRequest(actor("x", "PROCUREMENT_MANAGER"), pr())).toBe(true);
    expect(canCancelPurchaseRequest(actor(EMPLOYEE_ID, "EMPLOYEE"), pr())).toBe(true);
    expect(canCancelPurchaseRequest(actor(OTHER_EMPLOYEE_ID, "EMPLOYEE"), pr())).toBe(false);
    // PROCUREMENT_SPECIALIST can edit/submit a DRAFT but must NOT be able to cancel one.
    expect(canCancelPurchaseRequest(actor("x", "PROCUREMENT_SPECIALIST"), pr())).toBe(false);
    expect(canCancelPurchaseRequest(actor("x", "APPROVER"), pr())).toBe(false);
    expect(canCancelPurchaseRequest(actor("x", "SUPPLIER"), pr())).toBe(false);
  });

  it("APPROVED: ADMIN/MANAGER only, even the original requester (EMPLOYEE) cannot", () => {
    const approved = pr({ status: "APPROVED" });
    expect(canCancelPurchaseRequest(actor("x", "ADMIN"), approved)).toBe(true);
    expect(canCancelPurchaseRequest(actor(EMPLOYEE_ID, "EMPLOYEE"), approved)).toBe(false);
  });

  it("UNDER_APPROVAL can never be cancelled by anyone from the UI", () => {
    const underApproval = pr({ status: "UNDER_APPROVAL" });
    expect(canCancelPurchaseRequest(actor("x", "ADMIN"), underApproval)).toBe(false);
    expect(canCancelPurchaseRequest(actor("x", "PROCUREMENT_MANAGER"), underApproval)).toBe(false);
  });

  it("REJECTED and CANCELLED requests are immutable in the UI: no edit, no submit, no cancel", () => {
    for (const status of ["REJECTED", "CANCELLED"] as const) {
      const p = pr({ status });
      expect(canEditPurchaseRequest(actor("x", "ADMIN"), p)).toBe(false);
      expect(canSubmitPurchaseRequest(actor("x", "ADMIN"), p)).toBe(false);
      expect(canCancelPurchaseRequest(actor("x", "ADMIN"), p)).toBe(false);
    }
  });
});

describe("pr-permissions — assign buyer", () => {
  it("ADMIN/MANAGER only, and only while SUBMITTED/UNDER_APPROVAL/APPROVED", () => {
    expect(canAssignBuyer(actor("x", "ADMIN"), pr({ status: "UNDER_APPROVAL" }))).toBe(true);
    expect(canAssignBuyer(actor("x", "PROCUREMENT_MANAGER"), pr({ status: "APPROVED" }))).toBe(true);
    expect(canAssignBuyer(actor("x", "PROCUREMENT_SPECIALIST"), pr({ status: "UNDER_APPROVAL" }))).toBe(false);
    expect(canAssignBuyer(actor("x", "ADMIN"), pr({ status: "DRAFT" }))).toBe(false);
    expect(canAssignBuyer(actor("x", "ADMIN"), pr({ status: "REJECTED" }))).toBe(false);
    expect(canAssignBuyer(actor("x", "ADMIN"), pr({ status: "CANCELLED" }))).toBe(false);
  });
});
