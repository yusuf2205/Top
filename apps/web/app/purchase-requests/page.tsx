"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ProtectedRoute } from "../../components/protected-route";
import { AppShell } from "../../components/app-shell";
import { PurchaseRequestList } from "../../components/purchase-requests/list";
import { PurchaseRequestFilters } from "../../components/purchase-requests/filters";
import { SkeletonRows, EmptyState, ErrorState } from "../../components/list-states";
import { useAuth } from "../../lib/auth-context";
import { useMemberLookup } from "../../lib/member-lookup";
import { useRealtimeEvent, useRealtimeReconnect } from "../../lib/realtime";
import { isPurchaseRequestWorkflowEvent } from "../../lib/pr-realtime-helpers";
import { api, ApiError, type PurchaseRequestListQuery } from "../../lib/api-client";
import type { PurchaseRequestListResult } from "@top/types";

const CAN_CREATE_ROLES = ["ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST", "EMPLOYEE"];

export default function PurchaseRequestsPage() {
  return (
    <ProtectedRoute>
      <AppShell>
        <PurchaseRequestsContent />
      </AppShell>
    </ProtectedRoute>
  );
}

function PurchaseRequestsContent() {
  const { user } = useAuth();
  const resolveUser = useMemberLookup();
  const [filters, setFilters] = useState<PurchaseRequestListQuery>({ page: 1, pageSize: 20 });
  const [result, setResult] = useState<PurchaseRequestListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await api.purchaseRequests.list(filters));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось загрузить заявки");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filters)]);

  useEffect(() => {
    load();
  }, [load]);

  // Any workflow event for this organization invalidates the list — the
  // socket is already org-scoped server-side, so no entityId filtering is
  // needed here (unlike the detail page). Socket payload is never trusted
  // as state; this only triggers a REST refetch (Phase A §37).
  useRealtimeEvent((evt) => {
    if (isPurchaseRequestWorkflowEvent(evt)) load();
  });
  useRealtimeReconnect(load);

  const canCreate = user && CAN_CREATE_ROLES.includes(user.role);

  return (
    <>
      <div className="page-header">
        <h1>Заявки на закупку</h1>
        {canCreate && (
          <Link href="/purchase-requests/new" className="btn">
            + Создать заявку
          </Link>
        )}
      </div>

      <PurchaseRequestFilters value={filters} onChange={setFilters} />

      {error && <ErrorState message={error} onRetry={load} />}

      {!error && loading && <SkeletonRows count={6} />}

      {!error && !loading && result && result.items.length === 0 && (
        <EmptyState
          title="Заявок пока нет"
          description="Создайте первую заявку на закупку, чтобы начать работу."
          action={
            canCreate ? (
              <Link href="/purchase-requests/new" className="btn" style={{ width: "auto", marginTop: "0.75rem", display: "inline-flex" }}>
                + Создать заявку
              </Link>
            ) : undefined
          }
        />
      )}

      {!error && !loading && result && result.items.length > 0 && (
        <>
          <PurchaseRequestList items={result.items} resolveUser={resolveUser} />
          <div className="pagination">
            <span>
              Стр. {result.page} из {Math.max(1, Math.ceil(result.total / result.pageSize))} · всего {result.total}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              disabled={result.page <= 1}
              onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}
            >
              Назад
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              disabled={result.page * result.pageSize >= result.total}
              onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}
            >
              Далее
            </button>
          </div>
        </>
      )}
    </>
  );
}
