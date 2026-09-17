"use client";

import { useEffect, useState } from "react";
import type { CategorySummary, SupplierCapabilityView } from "@top/types";
import { Dialog } from "../dialog";
import { api, ApiError } from "../../lib/api-client";

/**
 * Category picker for "Категории поставок" (Phase D §41/§42). Only ACTIVE
 * categories are offered, and only ones not already assigned to this
 * supplier — the backend independently rejects an inactive-category add
 * (Final Hardening item 6), this just avoids offering a choice that would
 * be rejected anyway.
 */
export function SupplierCapabilityDialog({
  supplierId,
  existing,
  canManageCategoriesFlag,
  onOpenCategoryManager,
  onClose,
  onSuccess,
}: {
  supplierId: string;
  existing: SupplierCapabilityView[];
  canManageCategoriesFlag: boolean;
  onOpenCategoryManager: () => void;
  onClose: () => void;
  onSuccess: (capability: SupplierCapabilityView) => void;
}) {
  const [categories, setCategories] = useState<CategorySummary[] | null>(null);
  const [selected, setSelected] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.categories
      .list(false)
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  const assignedIds = new Set(existing.map((c) => c.categoryId));
  const available = (categories ?? []).filter((c) => !assignedIds.has(c.id));

  async function onSubmit() {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const capability = await api.suppliers.addCapability(supplierId, { categoryId: selected });
      onSuccess(capability);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось добавить категорию");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog title="Добавить категорию поставок" onClose={onClose} closeDisabled={submitting}>
      {error && <div className="form-error">{error}</div>}

      {categories === null && <p className="muted">Загрузка…</p>}

      {categories !== null && available.length === 0 && (
        <div>
          <p className="muted">
            {categories.length === 0 ? "Активных категорий пока нет." : "Все активные категории уже назначены этому поставщику."}
          </p>
          {canManageCategoriesFlag ? (
            <button type="button" className="btn btn-secondary btn-small" onClick={onOpenCategoryManager}>
              Управление категориями
            </button>
          ) : (
            <p className="muted" style={{ fontSize: "0.82rem" }}>
              Чтобы добавить новую категорию, обратитесь к администратору или менеджеру закупок.
            </p>
          )}
        </div>
      )}

      {categories !== null && available.length > 0 && (
        <div className="field">
          <label htmlFor="capability-category">Категория</label>
          <select id="capability-category" disabled={submitting} value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="" disabled>
              Выберите категорию
            </option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
          Отмена
        </button>
        {categories !== null && available.length > 0 && (
          <button type="button" className="btn" disabled={submitting || !selected} onClick={onSubmit}>
            {submitting ? "Добавление…" : "Добавить"}
          </button>
        )}
      </div>
    </Dialog>
  );
}
