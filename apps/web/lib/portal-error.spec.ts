import { classifyPortalError } from "./portal-error";

describe("classifyPortalError", () => {
  it("401 is always the generic invalid-link message — never distinguishes missing/unknown/expired/revoked", () => {
    expect(classifyPortalError(401)).toEqual({ kind: "invalid-link", message: "Ссылка недействительна или срок её действия истёк." });
    expect(classifyPortalError(401, "some backend detail")).toEqual({ kind: "invalid-link", message: "Ссылка недействительна или срок её действия истёк." });
  });

  describe("409 — Supplier-facing wording is always frontend-controlled, never the raw backend message", () => {
    it.each(["Quote already submitted", "Quote already submitted with a different payload", "Quote already submitted through another intake channel", "A quote has already been submitted"])(
      "%s -> already-submitted Russian message",
      (backendMessage) => {
        expect(classifyPortalError(409, backendMessage)).toEqual({ kind: "conflict", message: "Предложение уже было отправлено и не может быть изменено." });
      }
    );

    it("'Quote already declined' -> already-declined Russian message", () => {
      expect(classifyPortalError(409, "Quote already declined")).toEqual({ kind: "conflict", message: "Вы уже отказались от участия в этом запросе." });
    });

    it.each(["Response deadline has passed", "Submission deadline has passed", "RFQ is not open for a response (status CLOSED)", "RFQ is not open for submission (status CANCELLED)"])(
      "%s -> responses-closed Russian message",
      (backendMessage) => {
        expect(classifyPortalError(409, backendMessage)).toEqual({ kind: "conflict", message: "Приём предложений по этому запросу завершён." });
      }
    );

    it("an unrecognized 409 backend message falls back to a generic safe Russian message, and the original backend string is NEVER returned", () => {
      const unknown = "Some new backend conflict reason nobody mapped yet";
      const result = classifyPortalError(409, unknown);
      expect(result.kind).toBe("conflict");
      expect(result.message).toBe("Это действие сейчас недоступно.");
      expect(result.message).not.toContain(unknown);
    });

    it("a 409 with no backend message at all falls back to the generic safe message", () => {
      expect(classifyPortalError(409)).toEqual({ kind: "conflict", message: "Это действие сейчас недоступно." });
    });

    it("never surfaces internal/domain terminology verbatim to the Supplier", () => {
      const leaky = ["payloadHash mismatch on Quote", "Prisma error P2002", "Quote already submitted with a different payload", "source=PORTAL conflict"];
      for (const backendMessage of leaky) {
        const { message } = classifyPortalError(409, backendMessage);
        expect(message).not.toMatch(/payloadHash|Prisma|source=|PORTAL|MANUAL/);
      }
    });

    it("specifically: the exact reported defect string never reaches the rendered message", () => {
      const { message } = classifyPortalError(409, "Quote already submitted with a different payload");
      expect(message).toBe("Предложение уже было отправлено и не может быть изменено.");
      expect(message).not.toBe("Quote already submitted with a different payload");
    });
  });

  it("429 is unchanged — the rate-limit message", () => {
    expect(classifyPortalError(429).kind).toBe("rate-limited");
    expect(classifyPortalError(429).message).toBe("Слишком много запросов. Подождите немного и попробуйте снова.");
  });

  it("5xx is unchanged — a generic temporary-error message, never backend internals", () => {
    expect(classifyPortalError(500).message).toBe("Временная ошибка сервера. Попробуйте немного позже.");
    expect(classifyPortalError(503).kind).toBe("server-error");
  });

  it("null (network failure, no HTTP response at all) is its own distinct state", () => {
    expect(classifyPortalError(null).kind).toBe("network-error");
  });

  it("an unexpected status code falls back to network-error rather than crashing", () => {
    expect(classifyPortalError(418).kind).toBe("network-error");
  });
});
