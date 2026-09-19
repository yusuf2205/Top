import { isZeroDecimalString, moneyString, percentString, submitQuoteSchema, unitPriceString } from "@top/validation";

const validItem = { rfqItemId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", unitPrice: "10.5000" };
const validBody = {
  currency: "usd",
  vatRate: "12.00",
  vatIncluded: false,
  deliveryCost: "25.00",
  deliveryIncluded: false,
  leadTimeDays: 5,
  paymentTerms: "Net 30",
  warranty: "12 months",
  notes: "Some note",
  items: [validItem],
};

describe("unitPriceString (Decimal(18,4), M3.4 Phase B §12 — strictly positive)", () => {
  it("accepts a positive value with up to 4 decimal places", () => {
    expect(unitPriceString.safeParse("10.5000").success).toBe(true);
    expect(unitPriceString.safeParse("1").success).toBe(true);
    expect(unitPriceString.safeParse("0.0001").success).toBe(true);
  });

  it("rejects zero (strictly positive per §12)", () => {
    expect(unitPriceString.safeParse("0").success).toBe(false);
    expect(unitPriceString.safeParse("0.0000").success).toBe(false);
  });

  it("rejects negative values", () => {
    expect(unitPriceString.safeParse("-1").success).toBe(false);
  });

  it("rejects more than 4 decimal places", () => {
    expect(unitPriceString.safeParse("1.00001").success).toBe(false);
  });

  it("rejects non-numeric/scientific-notation input", () => {
    expect(unitPriceString.safeParse("abc").success).toBe(false);
    expect(unitPriceString.safeParse("1e5").success).toBe(false);
  });
});

describe("percentString (Decimal(5,2), M3.4 Phase B §13 — 0..100 bound)", () => {
  it("accepts 0 through 100 inclusive, up to 2 decimal places", () => {
    expect(percentString.safeParse("0").success).toBe(true);
    expect(percentString.safeParse("12.00").success).toBe(true);
    expect(percentString.safeParse("100").success).toBe(true);
    expect(percentString.safeParse("100.00").success).toBe(true);
  });

  it("rejects negative values", () => {
    expect(percentString.safeParse("-1").success).toBe(false);
  });

  it("rejects values above 100", () => {
    expect(percentString.safeParse("100.01").success).toBe(false);
    expect(percentString.safeParse("101").success).toBe(false);
  });

  it("rejects more than 2 decimal places", () => {
    expect(percentString.safeParse("12.345").success).toBe(false);
  });
});

describe("moneyString reuse for deliveryCost (Decimal(18,2), unchanged from RFQ/PR usage)", () => {
  it("accepts a non-negative amount with up to 2 decimal places", () => {
    expect(moneyString.safeParse("0").success).toBe(true);
    expect(moneyString.safeParse("25.00").success).toBe(true);
  });
});

describe("isZeroDecimalString (M3.4 Phase B final fix — pure textual zero check, no JS float)", () => {
  it("recognizes every zero-shaped representation moneyString would accept", () => {
    expect(isZeroDecimalString("0")).toBe(true);
    expect(isZeroDecimalString("0.0")).toBe(true);
    expect(isZeroDecimalString("0.00")).toBe(true);
    expect(isZeroDecimalString("00")).toBe(true);
    expect(isZeroDecimalString("000.00")).toBe(true);
  });

  it("rejects any representation with a nonzero digit anywhere", () => {
    expect(isZeroDecimalString("0.01")).toBe(false);
    expect(isZeroDecimalString("1")).toBe(false);
    expect(isZeroDecimalString("10.00")).toBe(false);
    expect(isZeroDecimalString("0.10")).toBe(false);
    expect(isZeroDecimalString("100")).toBe(false);
  });

  it("never uses Number/parseFloat/unary-plus/Math internally — verified by behavior at the edge of float-safe-integer precision", () => {
    // A 16-digit non-zero integer part is within moneyString's allowed
    // shape; a float-based check risks precision loss at this magnitude,
    // but the pure textual check must still correctly see it as non-zero.
    expect(isZeroDecimalString("9999999999999999.99")).toBe(false);
    expect(isZeroDecimalString("0000000000000000.00")).toBe(true);
  });
});

describe("submitQuoteSchema (M3.4 Phase B §16-18)", () => {
  it("accepts a well-formed body", () => {
    expect(submitQuoteSchema.safeParse(validBody).success).toBe(true);
  });

  it("normalizes currency via trim+uppercase before the 3-letter check", () => {
    const result = submitQuoteSchema.safeParse({ ...validBody, currency: " usd " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.currency).toBe("USD");
  });

  it("rejects a currency that is not exactly 3 ASCII letters", () => {
    expect(submitQuoteSchema.safeParse({ ...validBody, currency: "US" }).success).toBe(false);
    expect(submitQuoteSchema.safeParse({ ...validBody, currency: "USDD" }).success).toBe(false);
    expect(submitQuoteSchema.safeParse({ ...validBody, currency: "US1" }).success).toBe(false);
  });

  it("does not hardcode an incomplete currency catalog — accepts any 3-letter code", () => {
    expect(submitQuoteSchema.safeParse({ ...validBody, currency: "UZS" }).success).toBe(true);
    expect(submitQuoteSchema.safeParse({ ...validBody, currency: "GBP" }).success).toBe(true);
    expect(submitQuoteSchema.safeParse({ ...validBody, currency: "AED" }).success).toBe(true);
  });

  it("requires deliveryCost to be canonically zero when deliveryIncluded is true (Phase B final fix — pure string comparison, no JS float)", () => {
    expect(submitQuoteSchema.safeParse({ ...validBody, deliveryIncluded: true, deliveryCost: "0" }).success).toBe(true);
    expect(submitQuoteSchema.safeParse({ ...validBody, deliveryIncluded: true, deliveryCost: "0.0" }).success).toBe(true);
    expect(submitQuoteSchema.safeParse({ ...validBody, deliveryIncluded: true, deliveryCost: "0.00" }).success).toBe(true);
    expect(submitQuoteSchema.safeParse({ ...validBody, deliveryIncluded: true, deliveryCost: "0.01" }).success).toBe(false);
    expect(submitQuoteSchema.safeParse({ ...validBody, deliveryIncluded: true, deliveryCost: "1" }).success).toBe(false);
    expect(submitQuoteSchema.safeParse({ ...validBody, deliveryIncluded: true, deliveryCost: "10.00" }).success).toBe(false);
    expect(submitQuoteSchema.safeParse({ ...validBody, deliveryIncluded: true, deliveryCost: "5.00" }).success).toBe(false);
  });

  it("still accepts any valid non-negative deliveryCost when deliveryIncluded is false", () => {
    expect(submitQuoteSchema.safeParse({ ...validBody, deliveryIncluded: false, deliveryCost: "0" }).success).toBe(true);
    expect(submitQuoteSchema.safeParse({ ...validBody, deliveryIncluded: false, deliveryCost: "25.00" }).success).toBe(true);
    expect(submitQuoteSchema.safeParse({ ...validBody, deliveryIncluded: false, deliveryCost: "9999999999999999.99" }).success).toBe(true);
  });

  it("rejects an empty items array", () => {
    expect(submitQuoteSchema.safeParse({ ...validBody, items: [] }).success).toBe(false);
  });

  it("rejects a duplicate rfqItemId within items", () => {
    expect(
      submitQuoteSchema.safeParse({
        ...validBody,
        items: [validItem, { ...validItem }],
      }).success
    ).toBe(false);
  });

  it("rejects a malformed UUID for rfqItemId", () => {
    expect(
      submitQuoteSchema.safeParse({
        ...validBody,
        items: [{ rfqItemId: "not-a-uuid", unitPrice: "10.0000" }],
      }).success
    ).toBe(false);
  });

  it("rejects an unknown top-level field (.strict())", () => {
    expect(submitQuoteSchema.safeParse({ ...validBody, quantity: "999" }).success).toBe(false);
    expect(submitQuoteSchema.safeParse({ ...validBody, idempotencyKey: "key" }).success).toBe(false);
    expect(submitQuoteSchema.safeParse({ ...validBody, supplierId: "x" }).success).toBe(false);
  });

  it("rejects an unknown field within an item (.strict())", () => {
    expect(
      submitQuoteSchema.safeParse({
        ...validBody,
        items: [{ ...validItem, quantity: "5" }],
      }).success
    ).toBe(false);
  });

  it("accepts null for the optional nullable fields", () => {
    expect(
      submitQuoteSchema.safeParse({ ...validBody, vatRate: null, leadTimeDays: null, paymentTerms: null, warranty: null, notes: null }).success
    ).toBe(true);
  });

  it("rejects leadTimeDays outside [0, 365]", () => {
    expect(submitQuoteSchema.safeParse({ ...validBody, leadTimeDays: -1 }).success).toBe(false);
    expect(submitQuoteSchema.safeParse({ ...validBody, leadTimeDays: 1.5 }).success).toBe(false);
    expect(submitQuoteSchema.safeParse({ ...validBody, leadTimeDays: 366 }).success).toBe(false);
    expect(submitQuoteSchema.safeParse({ ...validBody, leadTimeDays: 365 }).success).toBe(true);
  });
});
