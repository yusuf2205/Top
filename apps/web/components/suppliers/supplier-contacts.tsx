"use client";

import { useState } from "react";
import type { SupplierContactView, SupplierDetail } from "@top/types";
import { SupplierContactDialog } from "./supplier-contact-dialog";
import { ConfirmDialog } from "../confirm-dialog";
import { api, ApiError } from "../../lib/api-client";

/** Only a plain `@username` is safely recognizable as a Telegram link (Phase D §39) — anything else renders as text, no attempted URL parsing. */
function telegramHref(value: string): string | null {
  const match = /^@([A-Za-z0-9_]{3,32})$/.exec(value.trim());
  return match ? `https://t.me/${match[1]}` : null;
}

/**
 * Renders contacts in the exact order the backend returns (active primary ->
 * active normal -> archived, Phase D §34) — never re-sorted client-side.
 * Archived contacts stay visible with a badge; no restore action exists
 * because the backend doesn't expose one (§38).
 */
export function SupplierContacts({
  supplier,
  editable,
  onChanged,
}: {
  supplier: SupplierDetail;
  editable: boolean;
  onChanged: (updated: SupplierDetail) => void;
}) {
  const [dialog, setDialog] = useState<
    { mode: "add" } | { mode: "edit"; contact: SupplierContactView } | { mode: "archive"; contact: SupplierContactView } | null
  >(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    onChanged(await api.suppliers.get(supplier.id));
  }

  async function promoteToPrimary(contact: SupplierContactView) {
    setBusyId(contact.id);
    setError(null);
    try {
      await api.suppliers.updateContact(supplier.id, contact.id, { isPrimary: true });
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сделать контакт основным — возможно, его уже изменили. Попробуйте ещё раз.");
    } finally {
      setBusyId(null);
    }
  }

  async function archive(contact: SupplierContactView) {
    setBusyId(contact.id);
    setError(null);
    try {
      await api.suppliers.archiveContact(supplier.id, contact.id);
      setDialog(null);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось архивировать контакт");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2 style={{ margin: 0 }}>Контакты</h2>
        {editable && (
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setDialog({ mode: "add" })}>
            + Добавить контакт
          </button>
        )}
      </div>

      {error && <div className="form-error">{error}</div>}

      {supplier.contacts.length === 0 && <p className="muted">Контактов пока нет.</p>}

      {supplier.contacts.map((c) => {
        const tgHref = c.telegram ? telegramHref(c.telegram) : null;
        const busy = busyId === c.id;
        return (
          <div className="item-row" key={c.id}>
            <div className="item-row-main">
              <div className="item-row-name">
                {c.fullName}
                {c.isPrimary && <span className="badge" style={{ marginLeft: "0.5rem" }}>Основной</span>}
                {!c.active && <span className="badge" style={{ marginLeft: "0.5rem" }}>Архив</span>}
              </div>
              <div className="item-row-meta">
                {c.position && <>{c.position} · </>}
                {c.phone && (
                  <>
                    <a href={`tel:${c.phone}`}>{c.phone}</a> ·{" "}
                  </>
                )}
                {c.email && (
                  <>
                    <a href={`mailto:${c.email}`}>{c.email}</a> ·{" "}
                  </>
                )}
                {c.telegram && (tgHref ? <a href={tgHref} target="_blank" rel="noopener noreferrer">{c.telegram}</a> : <span>{c.telegram}</span>)}
              </div>
            </div>
            {editable && c.active && (
              <div className="item-row-actions">
                {!c.isPrimary && (
                  <button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={() => promoteToPrimary(c)}>
                    Сделать основным
                  </button>
                )}
                <button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={() => setDialog({ mode: "edit", contact: c })}>
                  Изменить
                </button>
                <button type="button" className="btn btn-danger btn-small" disabled={busy} onClick={() => setDialog({ mode: "archive", contact: c })}>
                  Архивировать контакт
                </button>
              </div>
            )}
          </div>
        );
      })}

      {dialog?.mode === "add" && (
        <SupplierContactDialog
          mode="add"
          supplierId={supplier.id}
          onClose={() => setDialog(null)}
          onSuccess={async () => {
            setDialog(null);
            await reload();
          }}
        />
      )}
      {dialog?.mode === "edit" && (
        <SupplierContactDialog
          mode="edit"
          supplierId={supplier.id}
          existing={dialog.contact}
          onClose={() => setDialog(null)}
          onSuccess={async () => {
            setDialog(null);
            await reload();
          }}
        />
      )}
      {dialog?.mode === "archive" && (
        <ConfirmDialog
          title="Архивировать контакт"
          message={`Архивировать контакт «${dialog.contact.fullName}»?`}
          confirmLabel="Архивировать"
          danger
          pending={busyId === dialog.contact.id}
          onCancel={() => setDialog(null)}
          onConfirm={() => archive(dialog.contact)}
        />
      )}
    </div>
  );
}
