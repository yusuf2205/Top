"use client";

import { useState, type FormEvent } from "react";
import type { SupplierContactView } from "@top/types";
import { Dialog } from "../dialog";
import {
  EMPTY_CONTACT_FORM,
  buildCreateContactPayload,
  buildUpdateContactPayload,
  contactToFormState,
  hasContactChanges,
  validateContactForm,
  type ContactFormState,
} from "../../lib/supplier-payload";
import { api, ApiError } from "../../lib/api-client";

type Props =
  | { mode: "add"; supplierId: string; existing?: undefined; onClose: () => void; onSuccess: (contact: SupplierContactView) => void }
  | { mode: "edit"; supplierId: string; existing: SupplierContactView; onClose: () => void; onSuccess: (contact: SupplierContactView) => void };

/** Shared add/edit contact form (Phase D §35/§36) — `active` is never rendered or sent from here; archiving is its own dedicated action. */
export function SupplierContactDialog({ mode, supplierId, existing, onClose, onSuccess }: Props) {
  const [state, setState] = useState<ContactFormState>(() => (mode === "edit" ? contactToFormState(existing) : EMPTY_CONTACT_FORM));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = mode === "add" ? true : hasContactChanges(buildUpdateContactPayload(existing, state));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const validationError = validateContactForm(state);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const contact =
        mode === "add"
          ? await api.suppliers.addContact(supplierId, buildCreateContactPayload(state))
          : await api.suppliers.updateContact(supplierId, existing.id, buildUpdateContactPayload(existing, state));
      onSuccess(contact);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить контакт");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog title={mode === "add" ? "Новый контакт" : "Редактировать контакт"} onClose={onClose} closeDisabled={submitting}>
      {error && <div className="form-error">{error}</div>}
      <form onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="c-fullName">Имя *</label>
          <input id="c-fullName" required disabled={submitting} value={state.fullName} onChange={(e) => setState((s) => ({ ...s, fullName: e.target.value }))} />
        </div>
        <div className="field">
          <label htmlFor="c-position">Должность</label>
          <input id="c-position" disabled={submitting} value={state.position} onChange={(e) => setState((s) => ({ ...s, position: e.target.value }))} />
        </div>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <div className="field" style={{ flex: 1, minWidth: 150 }}>
            <label htmlFor="c-phone">Телефон</label>
            <input id="c-phone" disabled={submitting} value={state.phone} onChange={(e) => setState((s) => ({ ...s, phone: e.target.value }))} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 150 }}>
            <label htmlFor="c-email">Email</label>
            <input id="c-email" type="email" disabled={submitting} value={state.email} onChange={(e) => setState((s) => ({ ...s, email: e.target.value }))} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="c-telegram">Telegram</label>
          <input
            id="c-telegram"
            placeholder="@username или контакт"
            disabled={submitting}
            value={state.telegram}
            onChange={(e) => setState((s) => ({ ...s, telegram: e.target.value }))}
          />
        </div>
        <div className="field" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            id="c-primary"
            type="checkbox"
            style={{ width: "auto" }}
            disabled={submitting}
            checked={state.isPrimary}
            onChange={(e) => setState((s) => ({ ...s, isPrimary: e.target.checked }))}
          />
          <label htmlFor="c-primary" style={{ margin: 0 }}>
            Основной контакт
          </label>
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
            Отмена
          </button>
          <button type="submit" className="btn" disabled={submitting || !dirty}>
            {submitting ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
