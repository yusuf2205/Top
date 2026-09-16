"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { OrganizationMember, PurchaseRequestSummary } from "@top/types";
import { Dialog } from "../dialog";
import { api, ApiError } from "../../lib/api-client";
import { ELIGIBLE_BUYER_ROLES } from "../../lib/pr-permissions";

export function AssignBuyerDialog({
  purchaseRequestId,
  onClose,
  onSuccess,
}: {
  purchaseRequestId: string;
  onClose: () => void;
  onSuccess: (updated: PurchaseRequestSummary) => void;
}) {
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [selected, setSelected] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .members
      .list()
      .then((all) =>
        // Eligible targets only (Phase E §26): active + PROCUREMENT_MANAGER/
        // PROCUREMENT_SPECIALIST. Backend revalidates regardless — this only
        // avoids offering a choice the API would reject.
        setMembers(all.filter((m) => m.active && ELIGIBLE_BUYER_ROLES.includes(m.role)))
      )
      .catch(() => setMembers([]))
      .finally(() => setLoadingMembers(false));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await api.purchaseRequests.assignBuyer(purchaseRequestId, { assignedBuyerUserId: selected });
      onSuccess(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось назначить закупщика");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog title="Назначить закупщика" onClose={onClose} closeDisabled={submitting}>
      {error && <div className="form-error">{error}</div>}
      <form onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="buyer">Закупщик</label>
          {loadingMembers ? (
            <p className="muted">Загрузка…</p>
          ) : members.length === 0 ? (
            <p className="muted">Нет доступных сотрудников с ролью менеджера или специалиста по закупкам.</p>
          ) : (
            <select id="buyer" required value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="" disabled>
                Выберите сотрудника
              </option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fullName}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
            Отмена
          </button>
          <button type="submit" className="btn" disabled={submitting || !selected}>
            {submitting ? "Назначение…" : "Назначить"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
