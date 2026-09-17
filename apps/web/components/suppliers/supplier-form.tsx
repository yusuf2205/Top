"use client";

import type { SupplierFormState } from "../../lib/supplier-payload";

/**
 * Shared identity/contact field set — used by both the create page
 * (/suppliers/new) and the detail page's general-edit section, since the
 * two render an identical input set and differ only in how the surrounding
 * form builds its payload (Phase D §16/§25). Never renders supplierCode/
 * status/rating/normalizedTin/bank fields (Phase D §16) — those aren't part
 * of this shape at all.
 */
export function SupplierFormFields({
  state,
  onChange,
  disabled,
}: {
  state: SupplierFormState;
  onChange: (patch: Partial<SupplierFormState>) => void;
  disabled?: boolean;
}) {
  return (
    <>
      <div className="field">
        <label htmlFor="sf-companyName">Название компании *</label>
        <input
          id="sf-companyName"
          required
          disabled={disabled}
          value={state.companyName}
          onChange={(e) => onChange({ companyName: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="sf-legalName">Юридическое название</label>
        <input id="sf-legalName" disabled={disabled} value={state.legalName} onChange={(e) => onChange({ legalName: e.target.value })} />
      </div>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <div className="field" style={{ flex: 2, minWidth: 200 }}>
          <label htmlFor="sf-tin">ИНН / STIR / Tax ID</label>
          <input id="sf-tin" disabled={disabled} value={state.tin} onChange={(e) => onChange({ tin: e.target.value })} />
          <p className="muted" style={{ fontSize: "0.78rem", marginTop: "0.25rem" }}>
            Можно оставить пустым.
          </p>
        </div>
        <div className="field" style={{ width: 130 }}>
          <label htmlFor="sf-country">Страна (ISO-код)</label>
          <input
            id="sf-country"
            maxLength={2}
            placeholder="UZ"
            disabled={disabled}
            value={state.countryCode}
            onChange={(e) => onChange({ countryCode: e.target.value.toUpperCase() })}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="sf-address">Адрес</label>
        <input id="sf-address" disabled={disabled} value={state.address} onChange={(e) => onChange({ address: e.target.value })} />
      </div>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <div className="field" style={{ flex: 1, minWidth: 160 }}>
          <label htmlFor="sf-phone">Телефон</label>
          <input id="sf-phone" disabled={disabled} value={state.phone} onChange={(e) => onChange({ phone: e.target.value })} />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 160 }}>
          <label htmlFor="sf-email">Email</label>
          <input id="sf-email" type="email" disabled={disabled} value={state.email} onChange={(e) => onChange({ email: e.target.value })} />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 160 }}>
          <label htmlFor="sf-website">Сайт</label>
          <input id="sf-website" type="url" placeholder="https://example.com" disabled={disabled} value={state.website} onChange={(e) => onChange({ website: e.target.value })} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="sf-notes">Внутренние заметки</label>
        <textarea
          id="sf-notes"
          rows={3}
          maxLength={5000}
          disabled={disabled}
          value={state.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          style={{ width: "100%", padding: "0.55rem 0.7rem", border: "1px solid var(--color-border)", borderRadius: 6, fontSize: "0.9rem", fontFamily: "inherit" }}
        />
        <p className="muted" style={{ fontSize: "0.78rem", marginTop: "0.25rem" }}>
          Эти заметки видны только сотрудникам вашей организации.
        </p>
      </div>
    </>
  );
}
