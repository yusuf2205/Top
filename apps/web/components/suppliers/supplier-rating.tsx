"use client";

import { useState, type FormEvent } from "react";
import type { SupplierDetail } from "@top/types";
import { Dialog } from "../dialog";
import { formatSupplierRating } from "../../lib/supplier-labels";
import { api, ApiError } from "../../lib/api-client";

/** Client-side shape hint only — mirrors supplierRatingString in packages/validation/src/suppliers.ts. The backend remains the authoritative validator. */
const RATING_PATTERN = /^[1-5](\.\d{1,2})?$/;

/**
 * "Внутренняя оценка" (Phase D §32/§33). The persisted value is a raw
 * decimal string end to end — never Number()/parseFloat() anywhere in the
 * mutation path, only in the read-only display helper (formatSupplierRating).
 */
export function SupplierRating({
  supplier,
  editable,
  onSaved,
}: {
  supplier: SupplierDetail;
  editable: boolean;
  onSaved: (updated: SupplierDetail) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="card">
      <div className="card-header">
        <h2 style={{ margin: 0 }}>Внутренняя оценка</h2>
        {editable && (
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setOpen(true)}>
            Изменить
          </button>
        )}
      </div>
      <div className="meta-value" style={{ fontSize: "1.1rem" }}>
        {formatSupplierRating(supplier.rating)}
      </div>

      {open && <RatingDialog supplier={supplier} onClose={() => setOpen(false)} onSuccess={(updated) => { onSaved(updated); setOpen(false); }} />}
    </div>
  );
}

function RatingDialog({
  supplier,
  onClose,
  onSuccess,
}: {
  supplier: SupplierDetail;
  onClose: () => void;
  onSuccess: (updated: SupplierDetail) => void;
}) {
  const [rating, setRating] = useState(supplier.rating ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = rating.trim() === "" || RATING_PATTERN.test(rating.trim());

  async function submit(value: string | null) {
    setSubmitting(true);
    setError(null);
    try {
      const updated = await api.suppliers.updateRating(supplier.id, { rating: value });
      onSuccess(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить оценку");
    } finally {
      setSubmitting(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = rating.trim();
    if (!trimmed || !valid) return;
    submit(trimmed);
  }

  return (
    <Dialog title="Внутренняя оценка" onClose={onClose} closeDisabled={submitting}>
      {error && <div className="form-error">{error}</div>}
      <form onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="rating-value">Оценка (1–5)</label>
          <input
            id="rating-value"
            inputMode="decimal"
            placeholder="4.50"
            disabled={submitting}
            value={rating}
            onChange={(e) => setRating(e.target.value)}
          />
          <p className="muted" style={{ fontSize: "0.78rem", marginTop: "0.25rem" }}>
            из 5{!valid && rating.trim() && " · неверный формат"}
          </p>
        </div>
        <div className="dialog-actions">
          {supplier.rating !== null && (
            <button type="button" className="btn btn-secondary" disabled={submitting} onClick={() => submit(null)}>
              Очистить оценку
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
            Отмена
          </button>
          <button type="submit" className="btn" disabled={submitting || !rating.trim() || !valid}>
            {submitting ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
