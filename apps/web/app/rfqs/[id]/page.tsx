"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { RfqDetail } from "@top/types";
import { ProtectedRoute } from "../../../components/protected-route";
import { AppShell } from "../../../components/app-shell";
import { RfqStatusBadge } from "../../../components/rfqs/status-badge";
import { RfqActions } from "../../../components/rfqs/actions";
import { RfqHeaderEditForm } from "../../../components/rfqs/header-edit-form";
import { RfqItemsPanel } from "../../../components/rfqs/items-panel";
import { RfqSuppliersPanel } from "../../../components/rfqs/suppliers-panel";
import { SkeletonRows, ErrorState } from "../../../components/list-states";
import { useAuth } from "../../../lib/auth-context";
import { api, ApiError } from "../../../lib/api-client";
import { formatDate } from "../../../lib/pr-labels";
import { formatDeadline, isDeadlineOverdue } from "../../../lib/rfq-labels";
import { canEditRfqDraft } from "../../../lib/rfq-permissions";

export default function RfqDetailPage() {
  return (
    <ProtectedRoute>
      <AppShell>
        <RfqDetailContent />
      </AppShell>
    </ProtectedRoute>
  );
}

function RfqDetailContent() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();

  const [rfq, setRfq] = useState<RfqDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [editingHeader, setEditingHeader] = useState(false);

  // REST-only (Phase D §62/§105) — an id change (navigating between two RFQ
  // detail pages without a full remount) must never let an older in-flight
  // response for the PREVIOUS id overwrite the newer RFQ's data (§85).
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const data = await api.rfqs.get(id);
      if (seq !== requestSeq.current) return;
      setRfq(data);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      if (err instanceof ApiError && err.statusCode === 404) {
        setNotFound(true);
      } else {
        setError(err instanceof ApiError ? err.message : "Не удалось загрузить RFQ");
      }
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (notFound) {
    return (
      <div className="empty-state">
        <h3>RFQ не найден</h3>
      </div>
    );
  }

  if (error) return <ErrorState message={error} onRetry={load} />;

  if (loading || !rfq || !user) return <SkeletonRows count={4} />;

  const editable = rfq.status === "DRAFT" && canEditRfqDraft(user.role);

  return (
    <>
      <div className="pr-detail-header">
        <div>
          <div className="pr-detail-title">
            <h1>{rfq.rfqNumber}</h1>
            <RfqStatusBadge status={rfq.status} />
            {isDeadlineOverdue(rfq.status, rfq.deadline) && <span className="status-badge status-rejected">Срок истёк</span>}
          </div>
          {rfq.status === "CANCELLED" && (
            <p className="muted" style={{ marginTop: "0.3rem" }}>
              Отменён {formatDate(rfq.cancelledAt)}
              {rfq.cancelReason && <> · {rfq.cancelReason}</>}
            </p>
          )}
          {rfq.status === "CLOSED" && (
            <p className="muted" style={{ marginTop: "0.3rem" }}>
              Закрыт {formatDate(rfq.closedAt)}
            </p>
          )}
        </div>
        <RfqActions
          role={user.role}
          rfq={rfq}
          onUpdated={(updated) => {
            setRfq(updated);
            setEditingHeader(false);
          }}
          editing={editingHeader}
          onEditToggle={() => setEditingHeader((v) => !v)}
        />
      </div>

      <div className="card">
        <div className="meta-grid">
          <div>
            <div className="meta-label">Заявка</div>
            <div className="meta-value">
              <Link href={`/purchase-requests/${rfq.purchaseRequest.id}`}>{rfq.purchaseRequest.requestNumber}</Link>
            </div>
          </div>
          <div>
            <div className="meta-label">Срок ответа</div>
            <div className="meta-value">{formatDeadline(rfq.deadline)}</div>
          </div>
          <div>
            <div className="meta-label">Создан</div>
            <div className="meta-value">{formatDate(rfq.createdAt)}</div>
          </div>
          {rfq.sentAt && (
            <div>
              <div className="meta-label">Отправлен</div>
              <div className="meta-value">{formatDate(rfq.sentAt)}</div>
            </div>
          )}
          {rfq.supplierInstructions && (
            <div style={{ gridColumn: "1 / -1" }}>
              <div className="meta-label">Инструкции поставщику</div>
              <div className="meta-value">{rfq.supplierInstructions}</div>
            </div>
          )}
          {rfq.internalNotes && (
            <div style={{ gridColumn: "1 / -1" }}>
              <div className="meta-label">Внутренние заметки</div>
              <div className="meta-value">{rfq.internalNotes}</div>
            </div>
          )}
        </div>
      </div>

      {editingHeader && (
        <RfqHeaderEditForm
          rfq={rfq}
          onCancel={() => setEditingHeader(false)}
          onSaved={(updated) => {
            setRfq(updated);
            setEditingHeader(false);
          }}
        />
      )}

      <RfqItemsPanel rfqId={rfq.id} purchaseRequestId={rfq.purchaseRequest.id} items={rfq.items} editable={editable} onChanged={load} />

      <RfqSuppliersPanel rfqId={rfq.id} suppliers={rfq.suppliers} editable={editable} role={user.role} onChanged={load} />
    </>
  );
}
