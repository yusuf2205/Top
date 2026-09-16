import { buildItemInput, validateItemForm, EMPTY_ITEM_FORM, type ItemFormState } from "./pr-item-payload";

function state(overrides: Partial<ItemFormState> = {}): ItemFormState {
  return { ...EMPTY_ITEM_FORM, ...overrides };
}

describe("pr-item-payload — quantity stays a string", () => {
  it("passes the exact typed decimal string through untouched, never Number()-rounded", () => {
    const input = buildItemInput(state({ mode: "free-text", itemName: "Труба", quantity: "10.250", uomCode: "M" }));
    expect(input.quantity).toBe("10.250");
    expect(typeof input.quantity).toBe("string");
  });

  it("does not silently round or reformat an integer-looking value", () => {
    const input = buildItemInput(state({ mode: "free-text", itemName: "Болт", quantity: "1", uomCode: "PCS" }));
    expect(input.quantity).toBe("1");
  });
});

describe("pr-item-payload — product mode never sends itemName/skuSnapshot", () => {
  it("sends only productId, never itemName, when a catalog product is selected", () => {
    const input = buildItemInput(state({ mode: "product", productId: "prod-1", quantity: "5", uomCode: "KG" }));
    expect(input).toMatchObject({ productId: "prod-1", quantity: "5", uomCode: "KG" });
    expect(input).not.toHaveProperty("itemName");
    expect(input).not.toHaveProperty("skuSnapshot");
  });
});

describe("pr-item-payload — free-text mode requires itemName", () => {
  it("sends itemName, never productId, in free-text mode", () => {
    const input = buildItemInput(state({ mode: "free-text", itemName: "Кабель ВВГ", quantity: "20", uomCode: "M" }));
    expect(input).toMatchObject({ itemName: "Кабель ВВГ" });
    expect(input).not.toHaveProperty("productId");
  });

  it("client-side validation rejects an empty itemName in free-text mode", () => {
    expect(validateItemForm(state({ mode: "free-text", itemName: "", quantity: "1", uomCode: "PCS" }))).toMatch(/наименование/i);
  });

  it("client-side validation rejects a missing product in product mode", () => {
    expect(validateItemForm(state({ mode: "product", productId: null, quantity: "1", uomCode: "PCS" }))).toMatch(/товар/i);
  });

  it("client-side validation rejects a zero or missing quantity", () => {
    expect(validateItemForm(state({ mode: "free-text", itemName: "X", quantity: "0", uomCode: "PCS" }))).toBeTruthy();
    expect(validateItemForm(state({ mode: "free-text", itemName: "X", quantity: "", uomCode: "PCS" }))).toBeTruthy();
  });

  it("valid free-text form passes validation", () => {
    expect(validateItemForm(state({ mode: "free-text", itemName: "X", quantity: "1.5", uomCode: "KG" }))).toBeNull();
  });
});
