import type { SupplierStatus } from "@top/types";
import { SUPPLIER_STATUS_LABELS, SUPPLIER_STATUS_WARNINGS, formatCountryCode, formatSupplierRating, supplierStatusClassName } from "./supplier-labels";

const ALL_STATUSES: SupplierStatus[] = ["ACTIVE", "INACTIVE", "BLOCKED", "ARCHIVED"];

describe("supplier-labels — status label completeness", () => {
  it("every SupplierStatus has a Russian label", () => {
    for (const status of ALL_STATUSES) {
      expect(SUPPLIER_STATUS_LABELS[status]).toEqual(expect.any(String));
      expect(SUPPLIER_STATUS_LABELS[status].length).toBeGreaterThan(0);
    }
  });

  it("every SupplierStatus has a distinct CSS class", () => {
    const classes = ALL_STATUSES.map(supplierStatusClassName);
    expect(new Set(classes).size).toBe(ALL_STATUSES.length);
  });

  it("every SupplierStatus has a change-warning message", () => {
    for (const status of ALL_STATUSES) {
      expect(SUPPLIER_STATUS_WARNINGS[status].length).toBeGreaterThan(0);
    }
  });
});

describe("supplier-labels — rating display", () => {
  it("formats a decimal string consistently as 'X.XX / 5'", () => {
    expect(formatSupplierRating("4.5")).toBe("4.50 / 5");
    expect(formatSupplierRating("4")).toBe("4.00 / 5");
    expect(formatSupplierRating("3.75")).toBe("3.75 / 5");
  });

  it("null rating shows a neutral 'no rating' message, not a raw null/0", () => {
    expect(formatSupplierRating(null)).toBe("Нет оценки");
  });
});

describe("supplier-labels — country fallback", () => {
  it("renders the code as-is when present, a dash when absent", () => {
    expect(formatCountryCode("UZ")).toBe("UZ");
    expect(formatCountryCode(null)).toBe("—");
  });
});
