"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { RfqListResult } from "@top/types";
import { ProtectedRoute } from "../../components/protected-route";
import { AppShell } from "../../components/app-shell";
import { RfqList } from "../../components/rfqs/list";
import { RfqFilters } from "../../components/rfqs/filters";
import { SkeletonRows, EmptyState, ErrorState } from "../../components/list-states";
import { useAuth } from "../../lib/auth-context";
import { api, ApiError, type RfqListQuery } from "../../lib/api-client";
import { canCreateRfq } from "../../lib/rfq-permissions";

export default function RfqsPage() {
  return (
    <ProtectedRoute>
      <AppShell>
        <RfqsContent />
      </AppShell>
    </ProtectedRoute>
  );
}

function RfqsContent() {
  const { user } = useAuth();
  const [filters, setFilters] = useState<RfqListQuery>({ page: 1, pageSize: 20 });
  const [result, setResult] = useState<RfqListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // REST-only, no realtime (Phase D §62/§105) — a stale-response guard is
  // therefore the only thing protecting a rapid filter/page change from
  // having an older response land last and overwrite newer data.
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const data = await api.rfqs.list(filters);
      if (seq !== requestSeq.current) return;
      setResult(data);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(err instanceof ApiError ? err.message : "Не удалось загрузить запросы цен");
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filters)]);

  useEffect(() => {
    load();
  }, [load]);

  const canCreate = user && canCreateRfq(user.role);

  return (
    <>
      <div className="page-header">
        <h1>Запросы цен</h1>
        {canCreate && (
          <Link href="/rfqs/new" className="btn">
            + Создать RFQ
          </Link>
        )}
      </div>

      <RfqFilters value={filters} onChange={setFilters} />

      {error && <ErrorState message={error} onRetry={load} />}

      {!error && loading && <SkeletonRows count={6} />}

      {!error && !loading && result && result.items.length === 0 && (
        <EmptyState
          title="Запросов цен пока нет."
          action={
            canCreate ? (
              <Link href="/rfqs/new" className="btn" style={{ width: "auto", marginTop: "0.75rem", display: "inline-flex" }}>
                Создать RFQ
              </Link>
            ) : undefined
          }
        />
      )}

      {!error && !loading && result && result.items.length > 0 && (
        <>
          <RfqList items={result.items} />
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
