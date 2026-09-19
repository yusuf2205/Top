"use client";

import { useState } from "react";
import type { QuoteView, RfqSupplierView, UserRole } from "@top/types";
import { api, ApiError } from "../../lib/api-client";
import { canManagePortalAccess } from "../../lib/rfq-permissions";
import { getPortalAccessActions, formatPortalExpiry } from "../../lib/portal-access-labels";
import { SupplierStatusBadge } from "../suppliers/supplier-status-badge";
import { ConfirmDialog } from "../confirm-dialog";
import { RfqSupplierStatusBadge, PortalAccessBadge } from "./status-badge";
import { SupplierPicker } from "./supplier-picker";
import { CopyLinkDialog } from "./copy-link-dialog";
import { QuoteDetailDialog } from "./quote-detail-dialog";

/**
 * RFQ supplier identity snapshot display + DRAFT-only add/remove (Phase D
 * §45/§46/§56/§57). `supplierCodeSnapshot`/`companyNameSnapshot` are the
 * RFQ's OWN historical identity — never replaced with the Supplier's current
 * name. `currentSupplierStatus` is shown as a separate live badge so the
 * distinction between "what the RFQ recorded" and "what's true right now"
 * stays visible, never implying a later rename/status change rewrites RFQ
 * history.
 */
export function RfqSuppliersPanel({
  rfqId,
  suppliers,
  editable,
  role,
  onChanged,
}: {
  rfqId: string;
  suppliers: RfqSupplierView[];
  editable: boolean;
  role: UserRole;
  onChanged: () => void | Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<RfqSupplierView | null>(null);
  const [removing, setRemoving] = useState(false);

  // M3.4 Phase D §1/§22/§24 — portal-access controls. Only ONE of these
  // dialogs can be open at a time, mirroring the existing removeTarget
  // pattern. `linkDialog` holds the raw token ONLY in this transient local
  // state (captured before the row refetch, per §22) — never persisted,
  // never re-derived from `suppliers` after the dialog closes.
  const canManagePortal = canManagePortalAccess(role);
  const [actionPendingId, setActionPendingId] = useState<string | null>(null);
  const [linkDialog, setLinkDialog] = useState<{ token: string; reissued: boolean } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<RfqSupplierView | null>(null);
  const [reissueTarget, setReissueTarget] = useState<RfqSupplierView | null>(null);
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [quoteLoading, setQuoteLoading] = useState<string | null>(null);

  async function handleCreateLink(supplier: RfqSupplierView) {
    setActionPendingId(supplier.id);
    setError(null);
    try {
      const { token } = await api.rfqs.invitePortal(rfqId, supplier.id);
      setLinkDialog({ token, reissued: false });
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось создать ссылку");
    } finally {
      setActionPendingId(null);
    }
  }

  async function handleReissue() {
    if (!reissueTarget) return;
    setActionPendingId(reissueTarget.id);
    setError(null);
    try {
      const { token } = await api.rfqs.reissuePortal(rfqId, reissueTarget.id);
      setReissueTarget(null);
      setLinkDialog({ token, reissued: true });
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось переиздать ссылку");
    } finally {
      setActionPendingId(null);
    }
  }

  async function handleRevoke() {
    if (!revokeTarget) return;
    setActionPendingId(revokeTarget.id);
    setError(null);
    try {
      await api.rfqs.revokePortal(rfqId, revokeTarget.id);
      setRevokeTarget(null);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отозвать доступ");
    } finally {
      setActionPendingId(null);
    }
  }

  // M3.4 Phase D §42/§43 — deliberately NOT fetched for every supplier row on
  // load (no N+1). Only called on this explicit click.
  async function handleViewQuote(supplier: RfqSupplierView) {
    setQuoteLoading(supplier.id);
    setError(null);
    try {
      const q = await api.rfqs.getSupplierQuote(rfqId, supplier.id);
      setQuote(q);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось загрузить предложение");
    } finally {
      setQuoteLoading(null);
    }
  }

  /**
   * One-supplier-at-a-time backend endpoint (Phase C §45) — this batch is NOT
   * atomic, so e.g. Supplier A can commit while Supplier B fails (BLOCKED
   * since the picker loaded). Phase E §8: never a compensating DELETE, never
   * pretend the batch was atomic. Stop at the first failure; if anything
   * committed, refetch unconditionally so the UI matches the backend even on
   * partial success, and surface a message naming how many actually landed.
   */
  async function handleAddSelected() {
    if (pending.length === 0) {
      setAdding(false);
      return;
    }
    setSubmitting(true);
    setError(null);
    let addedCount = 0;
    let failureMessage: string | null = null;
    try {
      for (const supplierId of pending) {
        // Backend re-validates ACTIVE at the moment of insert — a supplier that
        // became inactive after the picker loaded surfaces its own clean error
        // here rather than being silently skipped (Phase D §45).
        await api.rfqs.addSupplier(rfqId, { supplierId });
        addedCount += 1;
      }
    } catch (err) {
      failureMessage = err instanceof ApiError ? err.message : "Не удалось добавить поставщика";
    }
    try {
      if (addedCount > 0) {
        setPending([]);
        setAdding(false);
        await onChanged();
      }
      if (failureMessage) {
        setError(addedCount > 0 ? `Добавлено поставщиков: ${addedCount}. Следующий поставщик не добавлен: ${failureMessage}` : failureMessage);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove() {
    if (!removeTarget) return;
    setRemoving(true);
    setError(null);
    try {
      await api.rfqs.removeSupplier(rfqId, removeTarget.id);
      setRemoveTarget(null);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось убрать поставщика");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2 style={{ margin: 0 }}>Поставщики</h2>
        {editable && !adding && (
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setAdding(true)}>
            + Добавить поставщика
          </button>
        )}
      </div>

      {error && <div className="form-error">{error}</div>}

      {adding && (
        <div style={{ marginBottom: "1rem" }}>
          <SupplierPicker excludeIds={suppliers.map((s) => s.supplierId)} selected={pending} onChange={setPending} />
          <div className="dialog-actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={submitting}
              onClick={() => {
                setAdding(false);
                setPending([]);
              }}
            >
              Отмена
            </button>
            <button type="button" className="btn" disabled={submitting || pending.length === 0} onClick={handleAddSelected}>
              {submitting ? "Добавление…" : `Добавить (${pending.length})`}
            </button>
          </div>
        </div>
      )}

      {suppliers.length === 0 && !adding && <p className="muted">Поставщики пока не выбраны.</p>}

      {suppliers.map((s) => {
        const actions = getPortalAccessActions(s.status, s.portalAccessActive);
        const rowPending = actionPendingId === s.id;
        return (
          <div className="item-row" key={s.id}>
            <div className="item-row-main">
              <div className="item-row-name">
                {s.companyNameSnapshot} <span className="muted">· {s.supplierCodeSnapshot}</span>
              </div>
              <div className="item-row-meta" style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                <RfqSupplierStatusBadge status={s.status} />
                <SupplierStatusBadge status={s.currentSupplierStatus} />
                {canManagePortal && <PortalAccessBadge status={s.status} active={s.portalAccessActive} />}
                {canManagePortal && s.portalAccessExpiresAt && (
                  <span className="muted" style={{ fontSize: "0.8rem" }}>
                    Доступ до {formatPortalExpiry(s.portalAccessExpiresAt)}
                  </span>
                )}
              </div>
            </div>
            <div className="item-row-actions">
              {canManagePortal && actions.canCreate && (
                <button type="button" className="btn btn-secondary btn-small" disabled={rowPending} onClick={() => handleCreateLink(s)}>
                  {rowPending ? "…" : "Создать ссылку"}
                </button>
              )}
              {canManagePortal && actions.canReissue && (
                <button type="button" className="btn btn-secondary btn-small" disabled={rowPending} onClick={() => setReissueTarget(s)}>
                  Перевыпустить ссылку
                </button>
              )}
              {canManagePortal && actions.canRevoke && (
                <button type="button" className="btn btn-danger btn-small" disabled={rowPending} onClick={() => setRevokeTarget(s)}>
                  Отозвать доступ
                </button>
              )}
              {s.status === "SUBMITTED" && (
                <button type="button" className="btn btn-small" disabled={quoteLoading === s.id} onClick={() => handleViewQuote(s)}>
                  {quoteLoading === s.id ? "…" : "Посмотреть предложение"}
                </button>
              )}
              {editable && (
                <button type="button" className="btn btn-danger btn-small" onClick={() => setRemoveTarget(s)}>
                  Убрать
                </button>
              )}
            </div>
          </div>
        );
      })}

      {removeTarget && (
        <ConfirmDialog
          title="Убрать поставщика из RFQ?"
          message="Поставщик будет исключён из этого RFQ. Карточка поставщика в системе не удаляется."
          confirmLabel="Убрать"
          danger
          pending={removing}
          onConfirm={handleRemove}
          onCancel={() => setRemoveTarget(null)}
        />
      )}

      {revokeTarget && (
        <ConfirmDialog
          title="Отозвать доступ по ссылке?"
          message={
            revokeTarget.status === "SUBMITTED"
              ? "После отзыва текущая ссылка поставщика перестанет работать.\nПолученное предложение сохранится. Будет отозван только доступ по ссылке."
              : "После отзыва текущая ссылка поставщика перестанет работать."
          }
          confirmLabel="Отозвать"
          danger
          pending={actionPendingId === revokeTarget.id}
          onConfirm={handleRevoke}
          onCancel={() => setRevokeTarget(null)}
        />
      )}

      {reissueTarget && (
        <ConfirmDialog
          title="Перевыпустить ссылку?"
          message="Старая ссылка перестанет работать сразу после создания новой. После подтверждения будет показана только новая ссылка."
          confirmLabel="Перевыпустить"
          pending={actionPendingId === reissueTarget.id}
          onConfirm={handleReissue}
          onCancel={() => setReissueTarget(null)}
        />
      )}

      {linkDialog && <CopyLinkDialog token={linkDialog.token} reissued={linkDialog.reissued} onClose={() => setLinkDialog(null)} />}

      {quote && <QuoteDetailDialog quote={quote} onClose={() => setQuote(null)} />}
    </div>
  );
}
