"use client";

import { useState } from "react";
import type { RfqDetail, UserRole } from "@top/types";
import { canCancelRfq, canCloseRfq, canEditRfqDraft, canSendRfq } from "../../lib/rfq-permissions";
import { RfqSendDialog } from "./send-dialog";
import { RfqCloseDialog } from "./close-dialog";
import { RfqCancelDialog } from "./cancel-dialog";

type OpenDialog = "send" | "close" | "cancel" | null;

/**
 * State-machine action gating (Phase D §36-40) — DRAFT gets edit/send/cancel,
 * SENT gets close/cancel only (never CLOSE from DRAFT, never a second SEND
 * button — §37 explicitly discourages re-showing it even though the backend
 * tolerates a repeat call), CLOSED/CANCELLED/IN_PROGRESS render no actions at
 * all and never crash on the dormant IN_PROGRESS value.
 */
export function RfqActions({
  role,
  rfq,
  onUpdated,
  editing,
  onEditToggle,
}: {
  role: UserRole;
  rfq: RfqDetail;
  onUpdated: (updated: RfqDetail) => void;
  editing: boolean;
  onEditToggle: () => void;
}) {
  const [openDialog, setOpenDialog] = useState<OpenDialog>(null);

  const isDraft = rfq.status === "DRAFT";
  const isSent = rfq.status === "SENT";

  const canEdit = isDraft && canEditRfqDraft(role);
  const canSend = isDraft && canSendRfq(role);
  const canCancel = (isDraft || isSent) && canCancelRfq(role);
  const canClose = isSent && canCloseRfq(role);

  const sendHints: string[] = [];
  if (canSend) {
    if (rfq.items.length === 0) sendHints.push("нет позиций");
    if (rfq.suppliers.length === 0) sendHints.push("нет поставщиков");
    if (!rfq.deadline) sendHints.push("не указан срок ответа");
  }

  const hasAnyAction = canEdit || canSend || canCancel || canClose;
  if (!hasAnyAction) return null;

  return (
    <>
      <div className="pr-actions">
        {canEdit && (
          <button type="button" className="btn btn-secondary" onClick={onEditToggle}>
            {editing ? "Готово" : "Редактировать"}
          </button>
        )}
        {canSend && (
          <button type="button" className="btn" onClick={() => setOpenDialog("send")}>
            Отправить RFQ
          </button>
        )}
        {sendHints.length > 0 && <span className="muted" style={{ fontSize: "0.82rem" }}>Перед отправкой: {sendHints.join(", ")}.</span>}
        {canClose && (
          <button type="button" className="btn btn-danger" onClick={() => setOpenDialog("close")}>
            Закрыть
          </button>
        )}
        {canCancel && (
          <button type="button" className="btn btn-danger" onClick={() => setOpenDialog("cancel")}>
            Отменить
          </button>
        )}
      </div>

      {openDialog === "send" && (
        <RfqSendDialog
          rfq={rfq}
          onClose={() => setOpenDialog(null)}
          onSuccess={(updated) => {
            onUpdated(updated);
            setOpenDialog(null);
          }}
        />
      )}
      {openDialog === "close" && (
        <RfqCloseDialog
          rfq={rfq}
          onClose={() => setOpenDialog(null)}
          onSuccess={(updated) => {
            onUpdated(updated);
            setOpenDialog(null);
          }}
        />
      )}
      {openDialog === "cancel" && (
        <RfqCancelDialog
          rfq={rfq}
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
