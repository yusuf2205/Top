"use client";

import { useEffect, useRef, useState } from "react";
import type { PurchaseRequestListItem, PurchaseRequestListResult } from "@top/types";
import { api, ApiError } from "../../lib/api-client";
import { formatBusinessDate } from "../../lib/pr-labels";
import { PurchaseRequestStatusBadge } from "../purchase-requests/status-badge";

const PAGE_SIZE = 10;

/**
 * Eligible-PR picker for direct /rfqs/new entry (no `purchaseRequestId`
 * query param — Phase D §16/§17). The existing Purchase Request list API
 * only accepts one `status` per request AND is paginated, so an older
 * eligible PR beyond the first page would otherwise be permanently
 * undiscoverable here (Phase E §10). Fixed with the smallest server-backed
 * improvement using the SAME existing endpoint — no new backend route:
 *   - per-status pagination (each status section pages independently)
 *   - an exact-match `requestNumber` search (the only search filter this
 *     list endpoint actually supports) applied to both status calls at once
 * List rows only (PurchaseRequestListItem) — no per-row detail fetch (§11).
 */
export function PrSelector({ onSelect }: { onSelect: (pr: PurchaseRequestListItem) => void }) {
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  function onSearchChange(v: string) {
    setSearchDraft(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(v.trim()), 300);
  }
  useEffect(() => () => clearTimeout(debounceRef.current), []);

  return (
    <div>
      <div className="field">
        <label htmlFor="pr-selector-search">Номер заявки</label>
        <input
          id="pr-selector-search"
          placeholder="PR-2026-000123 (точный номер)"
          value={searchDraft}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      <PrStatusSection status="APPROVED" title="Одобрено" search={search} onSelect={onSelect} />
      <PrStatusSection status="RFQ_IN_PROGRESS" title="Формирование запроса цен" search={search} onSelect={onSelect} />
    </div>
  );
}

function PrStatusSection({
  status,
  title,
  search,
  onSelect,
}: {
  status: "APPROVED" | "RFQ_IN_PROGRESS";
  title: string;
  search: string;
  onSelect: (pr: PurchaseRequestListItem) => void;
}) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<PurchaseRequestListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Older APPROVED/RFQ_IN_PROGRESS requests must never overwrite a newer
  // search/page result (Phase E §12) — same requestSeq discipline as the
  // Supplier picker.
  const requestSeq = useRef(0);

  useEffect(() => {
    setPage(1);
  }, [search]);

  useEffect(() => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    api.purchaseRequests
      .list({ status, requestNumber: search || undefined, page, pageSize: PAGE_SIZE })
      .then((data) => {
        if (seq !== requestSeq.current) return;
        setResult(data);
      })
      .catch((err) => {
        if (seq !== requestSeq.current) return;
        setError(err instanceof ApiError ? err.message : "Не удалось загрузить заявки");
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
  }, [status, search, page]);

  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <div style={{ marginBottom: "1rem" }}>
      <h3 style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", margin: "0 0 0.4rem" }}>
        {title}
        {result ? ` (${result.total})` : ""}
      </h3>
      {error && <div className="form-error">{error}</div>}
      {!error && loading && <p className="muted">Загрузка…</p>}
      {!error && !loading && result && result.items.length === 0 && <p className="muted">Нет заявок.</p>}
      {!error && !loading && result && result.items.length > 0 && (
        <div className="picker-list">
          {result.items.map((pr) => (
            <button
              key={pr.id}
              type="button"
              className="picker-row"
              style={{ width: "100%", textAlign: "left", background: "transparent", border: "none", borderBottom: "1px solid var(--color-border)", cursor: "pointer" }}
              onClick={() => onSelect(pr)}
            >
              <div className="picker-row-main">
                <div className="item-row-name">{pr.requestNumber}</div>
                <div className="item-row-meta" style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                  <PurchaseRequestStatusBadge status={pr.status} />
                  <span>{pr.itemCount} поз.</span>
                  {pr.requiredDate && <span>к {formatBusinessDate(pr.requiredDate)}</span>}
                </div>
              </div>
            </button>
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
