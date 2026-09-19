import { extractTokenFromHash, getPortalToken, setPortalToken } from "./portal-token";

describe("extractTokenFromHash", () => {
  it("extracts and decodes a simple token", () => {
    expect(extractTokenFromHash("#token=abc123")).toBe("abc123");
  });

  it("works without the leading #", () => {
    expect(extractTokenFromHash("token=abc123")).toBe("abc123");
  });

  it("URL-decodes the token value", () => {
    expect(extractTokenFromHash("#token=" + encodeURIComponent("a+b/c=d"))).toBe("a+b/c=d");
  });

  it("returns null for an empty hash", () => {
    expect(extractTokenFromHash("")).toBeNull();
    expect(extractTokenFromHash("#")).toBeNull();
  });

  it("returns null when there is no token param", () => {
    expect(extractTokenFromHash("#foo=bar")).toBeNull();
  });

  it("returns null for an empty token value", () => {
    expect(extractTokenFromHash("#token=")).toBeNull();
  });

  it("never throws on a garbage fragment", () => {
    expect(() => extractTokenFromHash("#%%%not-valid%%%")).not.toThrow();
  });
});

describe("in-memory token store", () => {
  afterEach(() => setPortalToken(null));

  it("is null by default", () => {
    expect(getPortalToken()).toBeNull();
  });

  it("round-trips a value set via setPortalToken (test-only escape hatch)", () => {
    setPortalToken("raw-token-value");
    expect(getPortalToken()).toBe("raw-token-value");
  });
});
