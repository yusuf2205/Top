import type { SubmitQuoteInput } from "@top/validation";
import { computeQuoteSubmitHash } from "./quote-submit-hash.util";

const ITEM_A = { rfqItemId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", unitPrice: "100.5000" };
const ITEM_B = { rfqItemId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", unitPrice: "200.0000" };

const base: SubmitQuoteInput = {
  currency: "USD",
  vatRate: "12.00",
  vatIncluded: false,
  deliveryCost: "50.00",
  deliveryIncluded: false,
  leadTimeDays: 10,
  paymentTerms: "Net 30",
  warranty: "12 months",
  notes: "Standard delivery",
  items: [ITEM_A, ITEM_B],
};

describe("computeQuoteSubmitHash", () => {
  it("hashes identically regardless of item array order", () => {
    const forward = computeQuoteSubmitHash(base);
    const reversed = computeQuoteSubmitHash({ ...base, items: [...base.items].reverse() });
    expect(forward).toBe(reversed);
  });

  it("hashes identically for currency in different case/whitespace", () => {
    const lower = computeQuoteSubmitHash({ ...base, currency: "usd" });
    const spaced = computeQuoteSubmitHash({ ...base, currency: " USD " });
    const upper = computeQuoteSubmitHash({ ...base, currency: "USD" });
    expect(lower).toBe(upper);
    expect(spaced).toBe(upper);
  });

  it("hashes identically for equivalent decimal representations of unitPrice", () => {
    const a = computeQuoteSubmitHash({
      ...base,
      items: [{ rfqItemId: ITEM_A.rfqItemId, unitPrice: "10" }],
    });
    const b = computeQuoteSubmitHash({
      ...base,
      items: [{ rfqItemId: ITEM_A.rfqItemId, unitPrice: "10.0" }],
    });
    const c = computeQuoteSubmitHash({
      ...base,
      items: [{ rfqItemId: ITEM_A.rfqItemId, unitPrice: "10.0000" }],
    });
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("hashes identically for equivalent decimal representations of deliveryCost/vatRate", () => {
    const a = computeQuoteSubmitHash({ ...base, deliveryCost: "50", vatRate: "12" });
    const b = computeQuoteSubmitHash({ ...base, deliveryCost: "50.00", vatRate: "12.00" });
    expect(a).toBe(b);
  });

  it("hashes identically for trimmed vs untrimmed text fields", () => {
    const trimmed = computeQuoteSubmitHash({ ...base, paymentTerms: "Terms", warranty: "Warranty", notes: "Notes" });
    const padded = computeQuoteSubmitHash({ ...base, paymentTerms: " Terms ", warranty: " Warranty ", notes: " Notes " });
    expect(trimmed).toBe(padded);
  });

  it("hashes identically for empty-string, whitespace-only, null, and omitted optional text fields", () => {
    const withNull = computeQuoteSubmitHash({ ...base, paymentTerms: null, warranty: null, notes: null });
    const withEmpty = computeQuoteSubmitHash({ ...base, paymentTerms: "", warranty: "", notes: "" });
    const withWhitespace = computeQuoteSubmitHash({ ...base, paymentTerms: "   ", warranty: "   ", notes: "   " });
    const { paymentTerms: _p, warranty: _w, notes: _n, ...withoutFields } = base;
    const withOmitted = computeQuoteSubmitHash(withoutFields as SubmitQuoteInput);
    expect(withNull).toBe(withEmpty);
    expect(withEmpty).toBe(withWhitespace);
    expect(withWhitespace).toBe(withOmitted);
  });

  it("changes when unitPrice actually changes", () => {
    const original = computeQuoteSubmitHash(base);
    const changed = computeQuoteSubmitHash({
      ...base,
      items: [{ ...ITEM_A, unitPrice: "999.0000" }, ITEM_B],
    });
    expect(original).not.toBe(changed);
  });

  it("changes when currency actually changes", () => {
    const original = computeQuoteSubmitHash(base);
    const changed = computeQuoteSubmitHash({ ...base, currency: "EUR" });
    expect(original).not.toBe(changed);
  });

  it("changes when vatRate/vatIncluded/deliveryCost/deliveryIncluded/leadTimeDays actually change", () => {
    const original = computeQuoteSubmitHash(base);
    expect(computeQuoteSubmitHash({ ...base, vatRate: "20.00" })).not.toBe(original);
    expect(computeQuoteSubmitHash({ ...base, vatIncluded: true })).not.toBe(original);
    expect(computeQuoteSubmitHash({ ...base, deliveryCost: "0", deliveryIncluded: true })).not.toBe(original);
    expect(computeQuoteSubmitHash({ ...base, leadTimeDays: 20 })).not.toBe(original);
  });

  it("changes when paymentTerms/warranty/notes actually change", () => {
    const original = computeQuoteSubmitHash(base);
    expect(computeQuoteSubmitHash({ ...base, paymentTerms: "Net 60" })).not.toBe(original);
    expect(computeQuoteSubmitHash({ ...base, warranty: "24 months" })).not.toBe(original);
    expect(computeQuoteSubmitHash({ ...base, notes: "Different note" })).not.toBe(original);
  });

  it("ignores server-derived/context fields that are not part of SubmitQuoteInput at all", () => {
    const withExtras = {
      ...base,
      quantity: "999",
      status: "SUBMITTED",
      submittedAt: "2026-01-01T00:00:00.000Z",
      token: "raw-token-should-never-affect-hash",
      tokenHash: "hash-should-never-affect-hash",
      supplierId: "some-supplier-id",
      rfqId: "some-rfq-id",
      organizationId: "some-org-id",
    };
    expect(computeQuoteSubmitHash(withExtras as unknown as SubmitQuoteInput)).toBe(computeQuoteSubmitHash(base));
  });
});
