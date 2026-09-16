import { PurchaseRequestStatus, PurchaseRequestPriority, UomCode } from "@top/types";
import { STATUS_LABELS, PRIORITY_LABELS, UOM_LABELS, formatUom, formatBusinessDate } from "./pr-labels";

describe("pr-labels", () => {
  it("maps every PurchaseRequestStatus enum value to a non-empty Russian label", () => {
    for (const status of Object.values(PurchaseRequestStatus)) {
      expect(STATUS_LABELS[status]).toBeTruthy();
      expect(STATUS_LABELS[status]).not.toMatch(/^[A-Z_]+$/); // never the raw enum string itself
    }
  });

  it("maps every PurchaseRequestPriority enum value to a non-empty Russian label", () => {
    for (const priority of Object.values(PurchaseRequestPriority)) {
      expect(PRIORITY_LABELS[priority]).toBeTruthy();
      expect(PRIORITY_LABELS[priority]).not.toMatch(/^[A-Z_]+$/);
    }
  });

  it("maps every UomCode enum value to a label, and never invents a code that doesn't exist", () => {
    for (const code of Object.values(UomCode)) {
      expect(formatUom(code)).toBeTruthy();
    }
    expect(Object.keys(UOM_LABELS).sort()).toEqual(Object.values(UomCode).sort());
  });

  it("formats a UTC-midnight business date from its Y-M-D digits, never shifting day by viewer timezone", () => {
    // Regression: new Date("2026-03-05T00:00:00.000Z").toLocaleDateString()
    // reinterprets UTC midnight in the *local* timezone — in any zone behind
    // UTC that silently renders 04.03.2026 instead of 05.03.2026. Parsing the
    // digits directly out of the ISO string sidesteps that entirely.
    expect(formatBusinessDate("2026-03-05T00:00:00.000Z")).toBe("05.03.2026");
    expect(formatBusinessDate("2026-01-01T00:00:00.000Z")).toBe("01.01.2026");
  });

  it("formats an absent business date as an em dash", () => {
    expect(formatBusinessDate(null)).toBe("—");
    expect(formatBusinessDate(undefined)).toBe("—");
  });
});
