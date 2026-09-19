"use client";

import { useState } from "react";
import type { SupplierPortalRfqView } from "@top/types";
import { ConfirmDialog } from "../confirm-dialog";
import { portalApi, PortalApiError } from "../../lib/portal-api-client";
import { classifyPortalError } from "../../lib/portal-error";

/**
 * M3.4 Phase D §16 — decline action. After a successful decline (or if the
 * page loads and `myStatus` is already DECLINED), no quote form is ever
 * shown again — same final read-only state either way (repeated decline is
 * idempotent on the backend, Architecture §14).
 */
export function PortalDeclineButton({ onDeclined }: { onDeclined: (rfq: SupplierPortalRfqView) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doDecline() {
    setPending(true);
    setError(null);
    try {
      const rfq = await portalApi.decline();
      setConfirming(false);
      onDeclined(rfq);
    } catch (err) {
      const statusCode = err instanceof PortalApiError ? err.statusCode || null : null;
      const message = err instanceof PortalApiError ? err.message : undefined;
      setError(classifyPortalError(statusCode, message).message);
      setConfirming(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="card">
      {error && <div className="form-error">{error}</div>}
      <button type="button" className="btn btn-danger btn-secondary" onClick={() => setConfirming(true)}>
        Отказаться от участия
      </button>

      {confirming && (
        <ConfirmDialog
          title="Отказаться от участия?"
          message="Вы не сможете отправить предложение по этому запросу после отказа."
          confirmLabel="Отказаться"
          danger
          pending={pending}
          onConfirm={doDecline}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

export function PortalDeclinedNotice() {
  return (
    <div className="card">
      <p>Вы отказались от участия в этом запросе.</p>
    </div>
  );
}
