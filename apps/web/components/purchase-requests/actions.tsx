"use client";

import { useState } from "react";
import type { PurchaseRequestSummary } from "@top/types";
import { api, ApiError } from "../../lib/api-client";
import {
  canApprovePurchaseRequest,
  canAssignBuyer,
  canCancelPurchaseRequest,
  canEditPurchaseRequest,
  canRejectPurchaseRequest,
  canSubmitPurchaseRequest,
  type Actor,
} from "../../lib/pr-permissions";
import { AssignBuyerDialog } from "./assign-buyer-dialog";
import { RejectPurchaseRequestDialog } from "./reject-dialog";
import { CancelPurchaseRequestDialog } from "./cancel-dialog";

type OpenDialog = "assign" | "reject" | "cancel" | null;

export function PurchaseRequestActions({
  actor,
  pr,
  onUpdated,
  onEditToggle,
  editing,
}: {
  actor: Actor;
  pr: PurchaseRequestSummary;
  onUpdated: (updated: PurchaseRequestSummary) => void;
  onEditToggle: () => void;
  editing: boolean;
}) {
  const [openDialog, setOpenDialog] = useState<OpenDialog>(null);
  const [submitting, setSubmitting] = useState<"submit" | "approve" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!confirm("Отправить заявку на согласование?")) return;
    setSubmitting("submit");
    setError(null);
    try {
      onUpdated(await api.purchaseRequests.submit(pr.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отправить заявку");
    } finally {
      setSubmitting(null);
    }
  }

  async function handleApprove() {
    if (!confirm("Одобрить заявку?")) return;
    setSubmitting("approve");
    setError(null);
    try {
      onUpdated(await api.purchaseRequests.approve(pr.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось одобрить заявку");
    } finally {
      setSubmitting(null);
    }
  }

  const canEdit = canEditPurchaseRequest(actor, pr);
  const canSubmit = canSubmitPurchaseRequest(actor, pr);
  const canApprove = canApprovePurchaseRequest(actor, pr);
  const canReject = canRejectPurchaseRequest(actor, pr);
  const canCancel = canCancelPurchaseRequest(actor, pr);
  const canAssign = canAssignBuyer(actor, pr);

  const hasAnyAction = canEdit || canSubmit || canApprove || canReject || canCancel || canAssign;
  if (!hasAnyAction) return null;

  return (
    <>
      {error && <div className="form-error">{error}</div>}
      <div className="pr-actions">
        {canEdit && (
          <button type="button" className="btn btn-secondary" onClick={onEditToggle}>
            {editing ? "Готово" : "Редактировать"}
          </button>
        )}
        {canSubmit && (
          <button type="button" className="btn" disabled={submitting === "submit"} onClick={handleSubmit}>
            {submitting === "submit" ? "Отправка…" : "Отправить на согласование"}
          </button>
        )}
        {pr.status === "DRAFT" && !canSubmit && pr.items.length === 0 && (
          <span className="muted" style={{ fontSize: "0.82rem" }}>
            Добавьте хотя бы одну позицию перед отправкой.
          </span>
        )}
        {canApprove && (
          <button type="button" className="btn" disabled={submitting === "approve"} onClick={handleApprove}>
            {submitting === "approve" ? "Одобрение…" : "Одобрить"}
          </button>
        )}
        {canReject && (
          <button type="button" className="btn btn-danger" onClick={() => setOpenDialog("reject")}>
            Отклонить
          </button>
        )}
        {canAssign && (
          <button type="button" className="btn btn-secondary" onClick={() => setOpenDialog("assign")}>
            Назначить закупщика
          </button>
        )}
        {canCancel && (
          <button type="button" className="btn btn-danger" onClick={() => setOpenDialog("cancel")}>
            Отменить заявку
          </button>
        )}
      </div>

      {openDialog === "assign" && (
        <AssignBuyerDialog purchaseRequestId={pr.id} onClose={() => setOpenDialog(null)} onSuccess={(updated) => { onUpdated(updated); setOpenDialog(null); }} />
      )}
      {openDialog === "reject" && (
        <RejectPurchaseRequestDialog purchaseRequestId={pr.id} onClose={() => setOpenDialog(null)} onSuccess={(updated) => { onUpdated(updated); setOpenDialog(null); }} />
      )}
      {openDialog === "cancel" && (
        <CancelPurchaseRequestDialog
          purchaseRequestId={pr.id}
          status={pr.status}
          onClose={() => setOpenDialog(null)}
          onSuccess={(updated) => {
            onUpdated(updated);
            setOpenDialog(null);
          }}
        />
      )}
    </>
  );
}
