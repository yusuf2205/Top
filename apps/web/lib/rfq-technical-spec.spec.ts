import { formatSpecValue } from "./rfq-technical-spec";

describe("formatSpecValue — safe rendering of arbitrary technicalSpec values (Phase E §19/§20)", () => {
  it("renders primitives as plain strings", () => {
    expect(formatSpecValue("steel")).toBe("steel");
    expect(formatSpecValue(42)).toBe("42");
    expect(formatSpecValue(true)).toBe("true");
    expect(formatSpecValue(false)).toBe("false");
  });

  it("renders null/undefined as a placeholder, never the literal 'null'/'undefined'", () => {
    expect(formatSpecValue(null)).toBe("—");
    expect(formatSpecValue(undefined)).toBe("—");
  });

  it("never returns a raw object — a nested object is always coerced to a string", () => {
    const result = formatSpecValue({ width: 10, height: 20 });
    expect(typeof result).toBe("string");
    expect(result).toBe('{"width":10,"height":20}');
  });

  it("never returns a raw array — coerced to a bounded string, not a wall of pretty-printed JSON", () => {
    const result = formatSpecValue(["A", "B", "C"]);
    expect(typeof result).toBe("string");
    expect(result).toBe('["A","B","C"]');
  });

  it("handles deeply nested structures without crashing", () => {
    const result = formatSpecValue({ dimensions: { w: 1, h: 2, tags: ["a", "b"] } });
    expect(typeof result).toBe("string");
    expect(() => formatSpecValue({ dimensions: { w: 1, h: 2, tags: ["a", "b"] } })).not.toThrow();
  });

  it("never throws on a circular reference — falls back to a safe placeholder instead of propagating JSON.stringify's TypeError", () => {
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;
    expect(() => formatSpecValue(circular)).not.toThrow();
    expect(formatSpecValue(circular)).toBe("—");
  });

  it("handles an empty object/array without crashing", () => {
    expect(formatSpecValue({})).toBe("{}");
    expect(formatSpecValue([])).toBe("[]");
  });
});
