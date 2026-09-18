import { isoToLocalDateInput, localDateEndToIso, localDateStartToIso } from "./rfq-filters";

describe("localDateStartToIso / localDateEndToIso — RFQ created-date range as LOCAL calendar day (Phase E final fix)", () => {
  it("omits the parameter (returns undefined) for an empty value", () => {
    expect(localDateStartToIso("")).toBeUndefined();
    expect(localDateEndToIso("")).toBeUndefined();
  });

  it("never throws and omits the parameter for a malformed value", () => {
    expect(() => localDateStartToIso("not-a-date")).not.toThrow();
    expect(localDateStartToIso("not-a-date")).toBeUndefined();
    expect(() => localDateEndToIso("2026-09")).not.toThrow();
    expect(localDateEndToIso("2026-09")).toBeUndefined();
  });

  it("rejects an out-of-range month/day rather than silently rolling over to a different calendar date", () => {
    expect(localDateStartToIso("2026-13-01")).toBeUndefined();
    expect(localDateStartToIso("2026-00-01")).toBeUndefined();
    expect(localDateStartToIso("2026-01-32")).toBeUndefined();
    expect(localDateStartToIso("2026-01-00")).toBeUndefined();
  });

  it("converts a local calendar day start using the same local Date-constructor semantics as the fix itself (portable across host timezones)", () => {
    const expected = new Date(2026, 8, 17, 0, 0, 0, 0).toISOString();
    expect(localDateStartToIso("2026-09-17")).toBe(expected);
  });

  it("converts a local calendar day end using the same local Date-constructor semantics", () => {
    const expected = new Date(2026, 8, 17, 23, 59, 59, 999).toISOString();
    expect(localDateEndToIso("2026-09-17")).toBe(expected);
  });

  it("never sends the bare YYYY-MM-DD string — always a full ISO instant", () => {
    const start = localDateStartToIso("2026-09-17");
    const end = localDateEndToIso("2026-09-17");
    expect(start).not.toBe("2026-09-17");
    expect(end).not.toBe("2026-09-17");
    expect(start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(end).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("start and end of the same local day are exactly 23:59:59.999 apart", () => {
    const start = localDateStartToIso("2026-09-17")!;
    const end = localDateEndToIso("2026-09-17")!;
    expect(new Date(end).getTime() - new Date(start).getTime()).toBe(23 * 3600_000 + 59 * 60_000 + 59_000 + 999);
  });
});

describe("isoToLocalDateInput — round-trips with the local-day helpers regardless of host timezone", () => {
  it("recovers the same local calendar day from localDateStartToIso's output", () => {
    const iso = localDateStartToIso("2026-09-17")!;
    expect(isoToLocalDateInput(iso)).toBe("2026-09-17");
  });

  it("recovers the same local calendar day from localDateEndToIso's output", () => {
    const iso = localDateEndToIso("2026-09-17")!;
    expect(isoToLocalDateInput(iso)).toBe("2026-09-17");
  });
});
