"use client";

import { useEffect, useRef, useState } from "react";
import type { CategorySummary, SupplierListResult } from "@top/types";
import { api, ApiError } from "../../lib/api-client";
import { formatSupplierRating } from "../../lib/supplier-labels";

/**
 * Search + paginate over ACTIVE Suppliers via the existing GET /suppliers
 * endpoint (Phase D §22/§23) — no new supplier-selection endpoint, server
 * pagination, no "load everything". Debounced search (~300ms) resets to
 * page 1. Selected ids are held by the PARENT (Phase D §25) so they stay
 * intact across page/search changes instead of being lost whenever the
 * current page of results changes — this component only ever toggles
 * membership in that external set, never owns it.
 */
export function SupplierPicker({
  excludeIds = [],
  selected,
  onChange,
}: {
  excludeIds?: string[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<SupplierListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestSeq = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    api.categories.list(false).then(setCategories).catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    api.suppliers
      .list({ status: "ACTIVE", search: search || undefined, categoryId, page, pageSize: 10 })
      .then((data) => {
        if (seq !== requestSeq.current) return;
        setResult(data);
      })
      .catch((err) => {
        if (seq !== requestSeq.current) return;
        setError(err instanceof ApiError ? err.message : "Не удалось загрузить поставщиков");
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
  }, [search, categoryId, page]);

  function onSearchChange(v: string) {
    setSearchDraft(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearch(v.trim());
      setPage(1);
    }, 300);
  }
  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const excludeSet = new Set(excludeIds);
  const selectedSet = new Set(selected);

  function toggle(id: string) {
    onChange(selectedSet.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  const candidates = (result?.items ?? []).filter((s) => !excludeSet.has(s.id));

  return (
    <div>
      <div className="filter-bar">
        <div className="field grow">
          <label htmlFor="supplier-picker-search">Поиск поставщика</label>
          <input id="supplier-picker-search" placeholder="Название, код или ИНН" value={searchDraft} onChange={(e) => onSearchChange(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="supplier-picker-category">Категория</label>
          <select
            id="supplier-picker-category"
            value={categoryId ?? ""}
            onChange={(e) => {
              setCategoryId(e.target.value || undefined);
              setPage(1);
            }}
          >
            <option value="">Все категории</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {selected.length > 0 && <p className="muted">Выбрано поставщиков: {selected.length}</p>}

      {error && <div className="form-error">{error}</div>}
      {!error && loading && <p className="muted">Загрузка…</p>}

      {!error && !loading && candidates.length === 0 && <p className="muted">Активные поставщики не найдены.</p>}

      {!error && !loading && candidates.length > 0 && (
        <div className="picker-list">
          {candidates.map((s) => (
            <label key={s.id} className="picker-row" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={selectedSet.has(s.id)} onChange={() => toggle(s.id)} />
              <div className="picker-row-main">
                <div className="item-row-name">
                  {s.companyName} <span className="muted">· {s.supplierCode}</span>
                </div>
                <div className="item-row-meta">
                  {s.tin && <>ИНН {s.tin} · </>}
                  {formatSupplierRating(s.rating)}
                </div>
              </div>
            </label>
          ))}
        </div>
      )}

      {result && result.total > result.pageSize && (
        <div className="pagination">
          <span>
            Стр. {page} из {totalPages}
          </span>
          <button type="button" className="btn btn-secondary btn-small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Назад
          </button>
          <button type="button" className="btn btn-secondary btn-small" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Далее
          </button>
        </div>
      )}
    </div>
  );
}
