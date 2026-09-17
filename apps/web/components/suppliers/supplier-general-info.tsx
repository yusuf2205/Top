"use client";

import { useState, type FormEvent } from "react";
import type { SupplierDetail } from "@top/types";
import { SupplierFormFields } from "./supplier-form";
import { formatCountryCode } from "../../lib/supplier-labels";
import { formatDateTime } from "../../lib/pr-labels";
import { buildUpdateSupplierPayload, hasSupplierChanges, supplierDetailToFormState, type SupplierFormState } from "../../lib/supplier-payload";
import { api, ApiError } from "../../lib/api-client";

/**
 * "Основная информация" (Phase D §24/§25). Editing reuses the same field set
 * as create (SupplierFormFields); the difference is purely in payload
 * construction — buildUpdateSupplierPayload diffs against the originally
 * loaded `supplier` so unchanged fields are omitted and cleared fields send
 * `null` (Phase D §26/§27). supplierCode/status/rating are never editable
 * here — they have their own dedicated UI.
 */
export function SupplierGeneralInfo({
  supplier,
  editable,
  onSaved,
}: {
  supplier: SupplierDetail;
  editable: boolean;
  onSaved: (updated: SupplierDetail) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<SupplierFormState>(() => supplierDetailToFormState(supplier));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEditing() {
    setState(supplierDetailToFormState(supplier));
    setError(null);
    setEditing(true);
  }

  const payload = buildUpdateSupplierPayload(supplier, state);
  const dirty = hasSupplierChanges(payload);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await api.suppliers.update(supplier.id, payload);
      onSaved(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить изменения");
    } finally {
      setSubmitting(false);
    }
  }

  if (!editing) {
    return (
      <>
      <div className="card">
        <div className="card-header">
          <h2 style={{ margin: 0 }}>Основная информация</h2>
          {editable && (
            <button type="button" className="btn btn-secondary btn-small" onClick={startEditing}>
              Редактировать
            </button>
          )}
        </div>
        <div className="meta-grid">
          {supplier.legalName && (
            <div>
              <div className="meta-label">Юридическое название</div>
              <div className="meta-value">{supplier.legalName}</div>
            </div>
          )}
          <div>
            <div className="meta-label">ИНН / STIR</div>
            <div className="meta-value">{supplier.tin ?? "—"}</div>
          </div>
          <div>
            <div className="meta-label">Страна</div>
            <div className="meta-value">{formatCountryCode(supplier.countryCode)}</div>
          </div>
          {supplier.phone && (
            <div>
              <div className="meta-label">Телефон</div>
              <div className="meta-value">
                <a href={`tel:${supplier.phone}`}>{supplier.phone}</a>
              </div>
            </div>
          )}
          {supplier.email && (
            <div>
              <div className="meta-label">Email</div>
              <div className="meta-value">
                <a href={`mailto:${supplier.email}`}>{supplier.email}</a>
              </div>
            </div>
          )}
          {supplier.website && (
            <div>
              <div className="meta-label">Сайт</div>
              <div className="meta-value">
                <a href={supplier.website} target="_blank" rel="noopener noreferrer">
                  {supplier.website}
                </a>
              </div>
            </div>
          )}
          {supplier.address && (
            <div style={{ gridColumn: "1 / -1" }}>
              <div className="meta-label">Адрес</div>
              <div className="meta-value">{supplier.address}</div>
            </div>
          )}
          <div>
            <div className="meta-label">Создан</div>
            <div className="meta-value">{formatDateTime(supplier.createdAt)}</div>
          </div>
          <div>
            <div className="meta-label">Обновлён</div>
            <div className="meta-value">{formatDateTime(supplier.updatedAt)}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 style={{ margin: 0 }}>Внутренние заметки</h2>
        </div>
        <p className="muted" style={{ fontSize: "0.8rem", marginTop: "-0.4rem" }}>
          Эти заметки видны только сотрудникам вашей организации.
        </p>
        {supplier.notes ? (
          <div className="meta-value" style={{ whiteSpace: "pre-wrap" }}>
            {supplier.notes}
          </div>
        ) : (
          <p className="muted">Заметок пока нет.</p>
        )}
      </div>
      </>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card">
      <div className="card-header">
        <h2 style={{ margin: 0 }}>Основная информация</h2>
      </div>
      {error && <div className="form-error">{error}</div>}
      <SupplierFormFields state={state} onChange={(patch) => setState((s) => ({ ...s, ...patch }))} disabled={submitting} />
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)} disabled={submitting}>
          Отмена
        </button>
        <button type="submit" className="btn" disabled={submitting || !dirty}>
          {submitting ? "Сохранение…" : "Сохранить"}
        </button>
      </div>
    </form>
  );
}
