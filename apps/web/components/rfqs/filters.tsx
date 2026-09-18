"use client";

import { useEffect, useRef, useState } from "react";
import type { RfqStatus } from "@top/types";
import type { RfqListQuery } from "../../lib/api-client";
import { RFQ_STATUS_LABELS } from "../../lib/rfq-labels";
import { isoToLocalDateInput, localDateEndToIso, localDateStartToIso } from "../../lib/rfq-filters";

const STATUS_OPTIONS = Object.entries(RFQ_STATUS_LABELS) as [RfqStatus, string][];

/**
 * Search + status + created-date-range are the backend-supported filters
 * (Phase C listRfqsQuerySchema) — no client-only filtering, no invented
 * Supplier-name filter (Phase D §11/§84). `purchaseRequestId` is deliberately
 * not a visible filter control here — it only ever arrives via the page's
 * own URL query param when opened from a Purchase Request context (§88).
 */
export function RfqFilters({ value, onChange }: { value: RfqListQuery; onChange: (next: RfqListQuery) => void }) {
  function set<K extends keyof RfqListQuery>(key: K, v: RfqListQuery[K]) {
    onChange({ ...value, [key]: v, page: 1 });
  }

  const [searchDraft, setSearchDraft] = useState(value.search ?? "");
  useEffect(() => setSearchDraft(value.search ?? ""), [value.search]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  function onSearchChange(v: string) {
    setSearchDraft(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => set("search", v.trim() || undefined), 300);
  }
  useEffect(() => () => clearTimeout(debounceRef.current), []);

  return (
    <div className="filter-bar">
      <div className="field grow">
        <label htmlFor="rfq-search">Поиск</label>
        <input id="rfq-search" placeholder="Номер RFQ или заявки" value={searchDraft} onChange={(e) => onSearchChange(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="rfq-status">Статус</label>
        <select id="rfq-status" value={value.status ?? ""} onChange={(e) => set("status", (e.target.value || undefined) as RfqStatus | undefined)}>
          <option value="">Все статусы</option>
          {STATUS_OPTIONS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="rfq-from">Создан с</label>
        <input
          id="rfq-from"
          type="date"
          value={value.createdAtFrom ? isoToLocalDateInput(value.createdAtFrom) : ""}
          onChange={(e) => set("createdAtFrom", localDateStartToIso(e.target.value))}
        />
      </div>
      <div className="field">
        <label htmlFor="rfq-to">по</label>
        <input
          id="rfq-to"
          type="date"
          value={value.createdAtTo ? isoToLocalDateInput(value.createdAtTo) : ""}
          onChange={(e) => set("createdAtTo", localDateEndToIso(e.target.value))}
        />
      </div>
    </div>
  );
}
