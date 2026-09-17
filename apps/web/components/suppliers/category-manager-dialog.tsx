"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { CategorySummary } from "@top/types";
import { Dialog } from "../dialog";
import { ConfirmDialog } from "../confirm-dialog";
import { api, ApiError } from "../../lib/api-client";

/**
 * "Категории поставщиков" (Phase D §44–§48) — a small supporting management
 * panel inside Supplier Master, not a new standalone Category module page.
 * No delete (the backend doesn't expose one — SupplierCategory's FK
 * restricts it implicitly); deactivating is the only lifecycle action, and
 * existing Supplier-category relationships are never touched by it.
 */
export function CategoryManagerDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void | Promise<void> }) {
  const [categories, setCategories] = useState<CategorySummary[] | null>(null);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<CategorySummary | null>(null);

  async function load() {
    setCategories(await api.categories.list(true));
  }

  useEffect(() => {
    load().catch(() => setCategories([]));
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await api.categories.create({ name: newName.trim() });
      setNewName("");
      await load();
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось создать категорию");
    } finally {
      setCreating(false);
    }
  }

  async function saveRename(id: string) {
    const name = renameDraft.trim();
    if (!name) return;
    setBusyId(id);
    setError(null);
    try {
      await api.categories.update(id, { name });
      setRenamingId(null);
      await load();
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось переименовать категорию");
    } finally {
      setBusyId(null);
    }
  }

  async function setActive(category: CategorySummary, active: boolean) {
    setBusyId(category.id);
    setError(null);
    try {
      await api.categories.update(category.id, { active });
      setDeactivateTarget(null);
      await load();
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось изменить категорию");
    } finally {
      setBusyId(null);
    }
  }

  /** Only deactivating needs confirmation — it's the one action with an irreversible-feeling side effect (existing assignments survive, but new ones can no longer be made). Reactivating is a plain, immediate toggle. */
  function onToggleActiveClick(category: CategorySummary) {
    if (category.active) {
      setDeactivateTarget(category);
    } else {
      setActive(category, true);
    }
  }

  const busy = creating || busyId !== null;

  return (
    <Dialog title="Категории поставщиков" onClose={onClose} closeDisabled={busy}>
      {error && <div className="form-error">{error}</div>}

      <form onSubmit={onCreate} className="inline-form" style={{ marginBottom: "1rem" }}>
        <div className="field">
          <label htmlFor="new-category-name">Новая категория</label>
          <input id="new-category-name" disabled={creating} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Название" />
        </div>
        <button type="submit" className="btn btn-secondary btn-small" disabled={creating || !newName.trim()}>
          {creating ? "Добавление…" : "Добавить"}
        </button>
      </form>

      {categories === null && <p className="muted">Загрузка…</p>}
      {categories !== null && categories.length === 0 && <p className="muted">Категорий пока нет.</p>}

      {categories?.map((c) => (
        <div className="item-row" key={c.id}>
          <div className="item-row-main">
            {renamingId === c.id ? (
              <input value={renameDraft} disabled={busyId === c.id} onChange={(e) => setRenameDraft(e.target.value)} autoFocus />
            ) : (
              <div className="item-row-name">
                {c.name} {!c.active && <span className="badge" style={{ marginLeft: "0.4rem" }}>Неактивна</span>}
              </div>
            )}
          </div>
          <div className="item-row-actions">
            {renamingId === c.id ? (
              <>
                <button type="button" className="btn btn-secondary btn-small" disabled={busyId === c.id} onClick={() => setRenamingId(null)}>
                  Отмена
                </button>
                <button type="button" className="btn btn-small" disabled={busyId === c.id || !renameDraft.trim()} onClick={() => saveRename(c.id)}>
                  Сохранить
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={busyId === c.id}
                  onClick={() => {
                    setRenamingId(c.id);
                    setRenameDraft(c.name);
                  }}
                >
                  Переименовать
                </button>
                <button type="button" className="btn btn-secondary btn-small" disabled={busyId === c.id} onClick={() => onToggleActiveClick(c)}>
                  {c.active ? "Деактивировать" : "Активировать"}
                </button>
              </>
            )}
          </div>
        </div>
      ))}

      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
          Закрыть
        </button>
      </div>

      {deactivateTarget && (
        <ConfirmDialog
          title="Деактивировать категорию"
          message={`«${deactivateTarget.name}»\n\nНеактивная категория останется в истории, но её нельзя будет назначить новым поставщикам.\n\nПродолжить?`}
          confirmLabel="Деактивировать"
          danger
          pending={busyId === deactivateTarget.id}
          onCancel={() => setDeactivateTarget(null)}
          onConfirm={() => setActive(deactivateTarget, false)}
        />
      )}
    </Dialog>
  );
}
