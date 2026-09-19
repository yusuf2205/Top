import { buildSubmitQuotePayload, isPortalQuoteFormValid, normalizeCurrencyInput, validatePortalQuoteForm, type PortalQuoteFormState } from "./portal-quote-payload";

const baseState: PortalQuoteFormState = {
  currency: "usd",
  vatRate: "",
  vatIncluded: false,
  deliveryCost: "0",
  deliveryIncluded: true,
  leadTimeDays: "",
  paymentTerms: "",
  warranty: "",
  notes: "",
  items: [{ rfqItemId: "item-1", unitPrice: "10.5000" }],
};

describe("normalizeCurrencyInput", () => {
  it("trims and uppercases", () => {
    expect(normalizeCurrencyInput(" usd ")).toBe("USD");
  });
});

describe("validatePortalQuoteForm", () => {
  it("accepts a valid minimal form", () => {
    expect(validatePortalQuoteForm(baseState)).toEqual({});
  });

  it("rejects a malformed currency", () => {
    const errors = validatePortalQuoteForm({ ...baseState, currency: "US" });
    expect(errors.currency).toBeDefined();
  });

  it("accepts any valid 3-letter code, not just UZS/USD/EUR", () => {
    expect(validatePortalQuoteForm({ ...baseState, currency: "gbp" }).currency).toBeUndefined();
    expect(validatePortalQuoteForm({ ...baseState, currency: "kzt" }).currency).toBeUndefined();
  });

  it("requires deliveryCost to be zero when deliveryIncluded is true", () => {
    const errors = validatePortalQuoteForm({ ...baseState, deliveryIncluded: true, deliveryCost: "5.00" });
    expect(errors.deliveryCost).toBeDefined();
  });

  it("allows a non-zero deliveryCost when deliveryIncluded is false", () => {
    const errors = validatePortalQuoteForm({ ...baseState, deliveryIncluded: false, deliveryCost: "5.00" });
    expect(errors.deliveryCost).toBeUndefined();
  });

  it("rejects a non-positive unitPrice", () => {
    const errors = validatePortalQuoteForm({ ...baseState, items: [{ rfqItemId: "item-1", unitPrice: "0" }] });
    expect(errors.items?.["item-1"]).toBeDefined();
  });

  it("rejects a vatRate above 100", () => {
    const errors = validatePortalQuoteForm({ ...baseState, vatRate: "150" });
    expect(errors.vatRate).toBeDefined();
  });

  it("accepts a valid vatRate", () => {
    const errors = validatePortalQuoteForm({ ...baseState, vatRate: "12.00" });
    expect(errors.vatRate).toBeUndefined();
  });

  it("rejects a non-integer leadTimeDays", () => {
    const errors = validatePortalQuoteForm({ ...baseState, leadTimeDays: "3.5" });
    expect(errors.leadTimeDays).toBeDefined();
  });
});

describe("isPortalQuoteFormValid", () => {
  it("is true for an empty errors object", () => {
    expect(isPortalQuoteFormValid({})).toBe(true);
  });
  it("is false when any error key is present", () => {
    expect(isPortalQuoteFormValid({ currency: "bad" })).toBe(false);
  });
});

describe("buildSubmitQuotePayload", () => {
  it("never includes quantity — server-authoritative only", () => {
    const payload = buildSubmitQuotePayload(baseState);
    expect(payload.items[0]).toEqual({ rfqItemId: "item-1", unitPrice: "10.5000" });
    expect(payload.items[0]).not.toHaveProperty("quantity");
  });

  it("normalizes currency to uppercase", () => {
    expect(buildSubmitQuotePayload(baseState).currency).toBe("USD");
  });

  it("omits optional fields entirely when blank, rather than sending empty strings", () => {
    const payload = buildSubmitQuotePayload(baseState);
    expect(payload).not.toHaveProperty("vatRate");
    expect(payload).not.toHaveProperty("leadTimeDays");
    expect(payload).not.toHaveProperty("paymentTerms");
    expect(payload).not.toHaveProperty("warranty");
    expect(payload).not.toHaveProperty("notes");
  });

  it("includes optional fields when provided", () => {
    const payload = buildSubmitQuotePayload({ ...baseState, vatRate: "12.00", leadTimeDays: "5", paymentTerms: "Net 30", warranty: "1 year", notes: "hello" });
    expect(payload.vatRate).toBe("12.00");
    expect(payload.leadTimeDays).toBe(5);
    expect(payload.paymentTerms).toBe("Net 30");
    expect(payload.warranty).toBe("1 year");
    expect(payload.notes).toBe("hello");
  });
});
