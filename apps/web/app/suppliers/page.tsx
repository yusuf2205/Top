"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { CategorySummary, SupplierListResult } from "@top/types";
import { ProtectedRoute } from "../../components/protected-route";
import { AppShell } from "../../components/app-shell";
import { SupplierList } from "../../components/suppliers/supplier-list";
import { SupplierFilters } from "../../components/suppliers/supplier-filters";
import { CategoryManagerDialog } from "../../components/suppliers/category-manager-dialog";
import { SkeletonRows, EmptyState, ErrorState } from "../../components/list-states";
import { useAuth } from "../../lib/auth-context";
import { api, ApiError, type SupplierListQuery } from "../../lib/api-client";
import { canCreateSupplier, canManageCategories } from "../../lib/supplier-permissions";

export default function SuppliersPage() {
  return (
    <ProtectedRoute>
      <AppShell>
        <SuppliersContent />
      </AppShell>
    </ProtectedRoute>
  );
}

function SuppliersContent() {
  const { user } = useAuth();
  const [filters, setFilters] = useState<SupplierListQuery>({ page: 1, pageSize: 20 });
  const [result, setResult] = useState<SupplierListResult | null>(null);
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);

  // Phase E hardening (§33): a rapid filter/search/page change can fire a
  // new request before an older one resolves. Without a guard, the OLDER
  // response could land last and overwrite the UI with stale data. This
  // token is the smallest possible fix — no cancellation library, just
  // "ignore a response that isn't from the most recent request".
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const data = await api.suppliers.list(filters);
      if (seq !== requestSeq.current) return;
      setResult(data);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(err instanceof ApiError ? err.message : "Не удалось загрузить поставщиков");
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filters)]);

  useEffect(() => {
    load();
  }, [load]);

  // Fetched once for the filter picker — never re-fetched per row (no N+1, Phase D §72).
  useEffect(() => {
    api.categories
      .list(false)
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  const canCreate = user && canCreateSupplier(user.role);
  const canManageCats = user && canManageCategories(user.role);

  return (
    <>
      <div className="page-header">
        <h1>Поставщики</h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {canManageCats && (
            <button type="button" className="btn btn-secondary" onClick={() => setManagerOpen(true)}>
              Управление категориями
            </button>
          )}
          {canCreate && (
            <Link href="/suppliers/new" className="btn">
              + Создать поставщика
            </Link>
          )}
        </div>
      </div>

      <SupplierFilters value={filters} onChange={setFilters} categories={categories} />

      {error && <ErrorState message={error} onRetry={load} />}

      {!error && loading && <SkeletonRows count={6} />}

      {!error && !loading && result && result.items.length === 0 && (
        <EmptyState
          title="Поставщиков пока нет"
          description="Добавьте первого поставщика, чтобы использовать его в закупках."
          action={
            canCreate ? (
              <Link href="/suppliers/new" className="btn" style={{ width: "auto", marginTop: "0.75rem", display: "inline-flex" }}>
                Создать поставщика
              </Link>
            ) : undefined
          }
        />
      )}

      {!error && !loading && result && result.items.length > 0 && (
        <>
          <SupplierList items={result.items} />
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

      {managerOpen && (
        <CategoryManagerDialog
          onClose={() => setManagerOpen(false)}
          onChanged={() => api.categories.list(false).then(setCategories).catch(() => undefined)}
        />
      )}
    </>
  );
}
