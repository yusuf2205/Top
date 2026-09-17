import { formatRfqNumber } from "./rfq-number.util";

describe("formatRfqNumber", () => {
  it("pads to a minimum of 6 digits", () => {
    expect(formatRfqNumber(2026, 1)).toBe("RFQ-2026-000001");
    expect(formatRfqNumber(2026, 42)).toBe("RFQ-2026-000042");
  });

  it("does not truncate values wider than 6 digits", () => {
    expect(formatRfqNumber(2026, 1234567)).toBe("RFQ-2026-1234567");
  });
});
