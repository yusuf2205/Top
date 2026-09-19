import { getPortalAccessLabel, getPortalAccessActions, portalAccessClassName, formatPortalExpiry, getQuoteSourceLabel } from "./portal-access-labels";

describe("getPortalAccessLabel", () => {
  it("SELECTED is always 'Не приглашён', regardless of active", () => {
    expect(getPortalAccessLabel("SELECTED", false)).toBe("Не приглашён");
    expect(getPortalAccessLabel("SELECTED", true)).toBe("Не приглашён");
  });

  it("INVITED/VIEWED show a standalone credential-state label, never inferred from status alone", () => {
    expect(getPortalAccessLabel("INVITED", true)).toBe("Ссылка активна");
    expect(getPortalAccessLabel("INVITED", false)).toBe("Доступ отозван");
    expect(getPortalAccessLabel("VIEWED", true)).toBe("Ссылка активна");
    expect(getPortalAccessLabel("VIEWED", false)).toBe("Доступ отозван");
  });

  it("SUBMITTED shows the compound label — quote received AND credential state", () => {
    expect(getPortalAccessLabel("SUBMITTED", true)).toBe("Предложение получено · доступ активен");
    expect(getPortalAccessLabel("SUBMITTED", false)).toBe("Предложение получено · доступ отозван");
  });

  it("DECLINED shows the compound label the same way", () => {
    expect(getPortalAccessLabel("DECLINED", true)).toBe("Отказался · доступ активен");
    expect(getPortalAccessLabel("DECLINED", false)).toBe("Отказался · доступ отозван");
  });

  it("EXPIRED is always 'Срок доступа истёк'", () => {
    expect(getPortalAccessLabel("EXPIRED", false)).toBe("Срок доступа истёк");
  });
});

describe("getPortalAccessActions", () => {
  it("SELECTED with no credential: only Create", () => {
    expect(getPortalAccessActions("SELECTED", false)).toEqual({ canCreate: true, canReissue: false, canRevoke: false });
  });

  it("INVITED/VIEWED/DECLINED with an active credential: Reissue + Revoke, never Create", () => {
    for (const status of ["INVITED", "VIEWED", "DECLINED"] as const) {
      expect(getPortalAccessActions(status, true)).toEqual({ canCreate: false, canReissue: true, canRevoke: true });
    }
  });

  it("SUBMITTED with an active credential: Revoke only, never Reissue (backend forbids it)", () => {
    expect(getPortalAccessActions("SUBMITTED", true)).toEqual({ canCreate: false, canReissue: false, canRevoke: true });
  });

  it("any status with a revoked (inactive) credential: no Reissue/Revoke offered", () => {
    expect(getPortalAccessActions("VIEWED", false)).toEqual({ canCreate: false, canReissue: false, canRevoke: false });
    expect(getPortalAccessActions("SUBMITTED", false)).toEqual({ canCreate: false, canReissue: false, canRevoke: false });
  });

  it("EXPIRED never offers Create/Reissue/Revoke", () => {
    expect(getPortalAccessActions("EXPIRED", false)).toEqual({ canCreate: false, canReissue: false, canRevoke: false });
  });
});

describe("portalAccessClassName", () => {
  it("maps to the existing status-badge palette, no new colors", () => {
    expect(portalAccessClassName("SELECTED", false)).toBe("status-draft");
    expect(portalAccessClassName("EXPIRED", false)).toBe("status-cancelled");
    expect(portalAccessClassName("VIEWED", true)).toBe("status-approved");
    expect(portalAccessClassName("VIEWED", false)).toBe("status-rejected");
  });
});

describe("formatPortalExpiry", () => {
  it("returns empty string for null", () => {
    expect(formatPortalExpiry(null)).toBe("");
  });
  it("formats a real instant", () => {
    expect(formatPortalExpiry("2026-09-26T12:00:00.000Z")).not.toBe("");
  });
});

describe("getQuoteSourceLabel", () => {
  it("maps every known channel to its Russian label", () => {
    expect(getQuoteSourceLabel("PORTAL")).toBe("Портал поставщика");
    expect(getQuoteSourceLabel("MANUAL")).toBe("Вручную");
    expect(getQuoteSourceLabel("FILE_IMPORT")).toBe("Файл");
    expect(getQuoteSourceLabel("EMAIL")).toBe("Email");
    expect(getQuoteSourceLabel("TELEGRAM")).toBe("Telegram");
    expect(getQuoteSourceLabel("WHATSAPP")).toBe("WhatsApp");
  });
  it("null (legacy/pre-addendum row) never guesses a channel", () => {
    expect(getQuoteSourceLabel(null)).toBe("Источник неизвестен");
  });
});
