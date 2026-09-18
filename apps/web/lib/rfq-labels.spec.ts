import type { RfqStatus, RfqSupplierStatus } from "@top/types";
import { RFQ_STATUS_LABELS, RFQ_SUPPLIER_STATUS_LABELS, formatDeadline, isDeadlineOverdue, rfqStatusClassName, rfqSupplierStatusClassName } from "./rfq-labels";

const ALL_RFQ_STATUSES: RfqStatus[] = ["DRAFT", "SENT", "IN_PROGRESS", "CLOSED", "CANCELLED"];
const ALL_SUPPLIER_STATUSES: RfqSupplierStatus[] = ["SELECTED", "INVITED", "VIEWED", "SUBMITTED", "DECLINED", "EXPIRED"];

describe("rfq-labels (Phase D §97)", () => {
  it("every RfqStatus has a non-empty Russian label, including the dormant IN_PROGRESS", () => {
    for (const status of ALL_RFQ_STATUSES) {
      expect(RFQ_STATUS_LABELS[status]).toBeTruthy();
      expect(typeof RFQ_STATUS_LABELS[status]).toBe("string");
    }
  });

  it("every RfqStatus resolves to a real class name, never falls through to undefined", () => {
    for (const status of ALL_RFQ_STATUSES) {
      expect(rfqStatusClassName(status)).toBeTruthy();
    }
  });

  it("every RfqSupplierStatus (including future dormant ones) has a non-empty Russian label", () => {
    for (const status of ALL_SUPPLIER_STATUSES) {
      expect(RFQ_SUPPLIER_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it("every RfqSupplierStatus resolves to a real class name", () => {
    for (const status of ALL_SUPPLIER_STATUSES) {
      expect(rfqSupplierStatusClassName(status)).toBeTruthy();
    }
  });

  it("SELECTED is labeled neutrally, never implying delivery/invitation (§78)", () => {
    expect(RFQ_SUPPLIER_STATUS_LABELS.SELECTED).toBe("Выбран");
  });

  it("formatDeadline handles null/undefined", () => {
    expect(formatDeadline(null)).toBe("Не указан");
    expect(formatDeadline(undefined)).toBe("Не указан");
  });

  it("formatDeadline renders a real instant", () => {
    expect(formatDeadline("2026-09-17T13:00:00.000Z")).toMatch(/2026/);
  });

  it("isDeadlineOverdue is false for DRAFT regardless of deadline", () => {
    expect(isDeadlineOverdue("DRAFT", "2000-01-01T00:00:00.000Z")).toBe(false);
  });

  it("isDeadlineOverdue is false when deadline is null", () => {
    expect(isDeadlineOverdue("SENT", null)).toBe(false);
  });

  it("isDeadlineOverdue is true for a SENT RFQ with a past deadline", () => {
    expect(isDeadlineOverdue("SENT", "2000-01-01T00:00:00.000Z")).toBe(true);
  });

  it("isDeadlineOverdue is false for a SENT RFQ with a future deadline", () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    expect(isDeadlineOverdue("SENT", future)).toBe(false);
  });

  it("never mutates/derives CLOSED/CANCELLED/IN_PROGRESS from an overdue deadline (§60) — isDeadlineOverdue returns a boolean hint only", () => {
    const result = isDeadlineOverdue("SENT", "2000-01-01T00:00:00.000Z");
    expect(typeof result).toBe("boolean");
  });
});
