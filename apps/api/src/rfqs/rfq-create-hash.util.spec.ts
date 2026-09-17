import { createRfqSchema } from "@top/validation";
import { computeRfqCreateHash } from "./rfq-create-hash.util";

function parse(input: unknown) {
  return createRfqSchema.parse(input);
}

const base = {
  purchaseRequestId: "11111111-1111-1111-1111-111111111111",
  purchaseRequestItemIds: ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"],
  supplierIds: ["cccccccc-cccc-cccc-cccc-cccccccccccc", "dddddddd-dddd-dddd-dddd-dddddddddddd"],
};

describe("computeRfqCreateHash", () => {
  it("hashes identically regardless of item/supplier array order", () => {
    const forward = computeRfqCreateHash(parse(base));
    const reversed = computeRfqCreateHash(
      parse({
        ...base,
        purchaseRequestItemIds: [...base.purchaseRequestItemIds].reverse(),
        supplierIds: [...base.supplierIds].reverse(),
      })
    );
    expect(forward).toBe(reversed);
  });

  it("hashes identically for equivalent deadline instants expressed with different offsets", () => {
    const utc = computeRfqCreateHash(parse({ ...base, deadline: "2026-12-31T12:00:00.000Z" }));
    const offset = computeRfqCreateHash(parse({ ...base, deadline: "2026-12-31T17:00:00.000+05:00" }));
    expect(utc).toBe(offset);
  });

  it("hashes identically whether a field is omitted or explicitly null", () => {
    const omitted = computeRfqCreateHash(parse({ ...base }));
    const explicitNull = computeRfqCreateHash(parse({ ...base, deadline: null, supplierInstructions: null, internalNotes: null }));
    expect(omitted).toBe(explicitNull);
  });

  it("changes when the item or supplier set actually changes", () => {
    const original = computeRfqCreateHash(parse(base));
    const changed = computeRfqCreateHash(parse({ ...base, supplierIds: [base.supplierIds[0]] }));
    expect(original).not.toBe(changed);
  });

  it("does not change when only idempotencyKey changes", () => {
    const withKeyA = computeRfqCreateHash(parse({ ...base, idempotencyKey: "key-a" }));
    const withKeyB = computeRfqCreateHash(parse({ ...base, idempotencyKey: "key-b" }));
    expect(withKeyA).toBe(withKeyB);
  });
});
