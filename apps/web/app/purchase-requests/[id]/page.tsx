"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { PurchaseRequestSummary } from "@top/types";
import { ProtectedRoute } from "../../../components/protected-route";
import { AppShell } from "../../../components/app-shell";
import { PurchaseRequestStatusBadge } from "../../../components/purchase-requests/status-badge";
import { PurchaseRequestPriorityBadge } from "../../../components/purchase-requests/priority-badge";
import { PurchaseRequestItems } from "../../../components/purchase-requests/items-list";
import { PurchaseRequestActions } from "../../../components/purchase-requests/actions";
import { ApprovalCard } from "../../../components/purchase-requests/approval-card";
import { HeaderEditForm } from "../../../components/purchase-requests/header-edit-form";
import { SkeletonRows, ErrorState } from "../../../components/list-states";
import { useAuth } from "../../../lib/auth-context";
import { useMemberLookup } from "../../../lib/member-lookup";
import { useRealtimeEvent, useRealtimeReconnect } from "../../../lib/realtime";
import { eventMatchesPurchaseRequest } from "../../../lib/pr-realtime-helpers";
import { formatBusinessDate, formatDate, formatMoney } from "../../../lib/pr-labels";
import { api, ApiError } from "../../../lib/api-client";
import { canEditPurchaseRequest, type Actor } from "../../../lib/pr-permissions";

export default function PurchaseRequestDetailPage() {
  return (
    <ProtectedRoute>
      <AppShell>
        <PurchaseRequestDetailContent />
      </AppShell>
    </ProtectedRoute>
  );
}

function PurchaseRequestDetailContent() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const resolveUser = useMemberLookup();

  const [pr, setPr] = useState<PurchaseRequestSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [editingHeader, setEditingHeader] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      setPr(await api.purchaseRequests.get(id));
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 404) {
        setNotFound(true);
      } else {
        setError(err instanceof ApiError ? err.message : "Не удалось загрузить заявку");
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Detail page reconciliation: only an event for THIS exact request
  // triggers a refetch — an event for a different PR in the same
  // organization is deliberately ignored here (Phase A §37).
  useRealtimeEvent((evt) => {
    if (eventMatchesPurchaseRequest(evt, id)) load();
  });
  useRealtimeReconnect(load);

  if (notFound) {
    return (
      <div className="empty-state">
        <h3>Заявка не найдена</h3>
      </div>
    );
  }

  if (error) return <ErrorState message={error} onRetry={load} />;

  if (loading || !pr) return <SkeletonRows count={4} />;

  const actor: Actor = { id: user!.id, role: user!.role };

  return (
    <>
      <div className="pr-detail-header">
        <div>
          <div className="pr-detail-title">
            <h1>{pr.requestNumber}</h1>
            <PurchaseRequestStatusBadge status={pr.status} />
            <PurchaseRequestPriorityBadge priority={pr.priority} />
          </div>
          {pr.status === "CANCELLED" && (
            <p className="muted" style={{ marginTop: "0.3rem" }}>
              Отменено {formatDate(pr.cancelledAt)}
              {pr.cancelledByUserId && <> · {resolveUser(pr.cancelledByUserId)}</>}
            </p>
          )}
        </div>
        <PurchaseRequestActions actor={actor} pr={pr} onUpdated={setPr} editing={editingHeader} onEditToggle={() => setEditingHeader((v) => !v)} />
      </div>

      <div className="card">
        <div className="meta-grid">
          <div>
            <div className="meta-label">Инициатор</div>
            <div className="meta-value">{resolveUser(pr.requesterId)}</div>
          </div>
          <div>
            <div className="meta-label">Закупщик</div>
            <div className="meta-value">{pr.assignedBuyerUserId ? resolveUser(pr.assignedBuyerUserId) : "Не назначен"}</div>
          </div>
          <div>
            <div className="meta-label">Требуемая дата</div>
            <div className="meta-value">{formatBusinessDate(pr.requiredDate)}</div>
          </div>
          <div>
            <div className="meta-label">Ориентировочный бюджет</div>
            <div className="meta-value">{formatMoney(pr.estimatedBudget, pr.currency)}</div>
          </div>
          <div>
            <div className="meta-label">Создана</div>
            <div className="meta-value">{formatDate(pr.createdAt)}</div>
          </div>
          {pr.reason && (
            <div style={{ gridColumn: "1 / -1" }}>
              <div className="meta-label">Обоснование</div>
              <div className="meta-value">{pr.reason}</div>
            </div>
          )}
        </div>
      </div>

      {editingHeader && <HeaderEditForm pr={pr} onCancel={() => setEditingHeader(false)} onSaved={(updated) => { setPr(updated); setEditingHeader(false); }} />}

      {pr.approval && <ApprovalCard approval={pr.approval} resolveUser={resolveUser} />}

      <PurchaseRequestItems purchaseRequestId={pr.id} items={pr.items} editable={canEditPurchaseRequest(actor, pr)} onChanged={load} />
    </>
  );
}
