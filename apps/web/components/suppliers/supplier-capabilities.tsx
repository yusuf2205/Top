"use client";

import { useState } from "react";
import type { SupplierCapabilityView, SupplierDetail } from "@top/types";
import { SupplierCapabilityDialog } from "./supplier-capability-dialog";
import { CategoryManagerDialog } from "./category-manager-dialog";
import { ConfirmDialog } from "../confirm-dialog";
import { api, ApiError } from "../../lib/api-client";

/** "Категории поставок" (Phase D §40–§43) — what this Supplier can supply. Compact chips, not a full taxonomy browser (that's the separate Category Manager). */
export function SupplierCapabilities({
  supplier,
  editable,
  canManageCategoriesFlag,
  onChanged,
}: {
  supplier: SupplierDetail;
  editable: boolean;
  canManageCategoriesFlag: boolean;
  onChanged: (updated: SupplierDetail) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<SupplierCapabilityView | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    onChanged(await api.suppliers.get(supplier.id));
  }

  async function remove(categoryId: string) {
    setBusyId(categoryId);
    setError(null);
    try {
      await api.suppliers.removeCapability(supplier.id, categoryId);
      setRemoveTarget(null);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось убрать категорию");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2 style={{ margin: 0 }}>Категории поставок</h2>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {canManageCategoriesFlag && (
            <button type="button" className="btn btn-secondary btn-small" onClick={() => setManagerOpen(true)}>
              Управление категориями
            </button>
          )}
          {editable && (
            <button type="button" className="btn btn-secondary btn-small" onClick={() => setAddOpen(true)}>
              + Добавить категорию
            </button>
          )}
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}

      {supplier.categories.length === 0 && <p className="muted">Категории пока не назначены.</p>}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {supplier.categories.map((c) => (
          <span key={c.categoryId} className="badge" style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
            {c.categoryName}
            {editable && (
              <button
                type="button"
                aria-label={`Убрать категорию ${c.categoryName}`}
                disabled={busyId === c.categoryId}
                onClick={() => setRemoveTarget(c)}
                style={{ border: "none", background: "transparent", cursor: "pointer", color: "inherit", padding: 0, fontSize: "0.9rem", lineHeight: 1 }}
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>

      {addOpen && (
        <SupplierCapabilityDialog
          supplierId={supplier.id}
          existing={supplier.categories}
          canManageCategoriesFlag={canManageCategoriesFlag}
          onOpenCategoryManager={() => {
            setAddOpen(false);
            setManagerOpen(true);
          }}
          onClose={() => setAddOpen(false)}
          onSuccess={async () => {
            setAddOpen(false);
            await reload();
          }}
        />
      )}

      {managerOpen && <CategoryManagerDialog onClose={() => setManagerOpen(false)} onChanged={reload} />}

      {removeTarget && (
        <ConfirmDialog
          title="Убрать категорию"
          message={`Убрать категорию «${removeTarget.categoryName}» у поставщика?`}
          confirmLabel="Убрать"
          danger
          pending={busyId === removeTarget.categoryId}
          onCancel={() => setRemoveTarget(null)}
          onConfirm={() => remove(removeTarget.categoryId)}
        />
      )}
    </div>
  );
}
