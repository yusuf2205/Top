"use client";

import { useEffect, useRef, useState } from "react";
import type { PurchaseRequestPriority, PurchaseRequestStatus } from "@top/types";
import type { PurchaseRequestListQuery } from "../../lib/api-client";
import { PRIORITY_LABELS, STATUS_LABELS } from "../../lib/pr-labels";

const STATUS_OPTIONS = Object.entries(STATUS_LABELS) as [PurchaseRequestStatus, string][];
const PRIORITY_OPTIONS = Object.entries(PRIORITY_LABELS) as [PurchaseRequestPriority, string][];

export function PurchaseRequestFilters({
  value,
  onChange,
}: {
  value: PurchaseRequestListQuery;
  onChange: (next: PurchaseRequestListQuery) => void;
}) {
  function set<K extends keyof PurchaseRequestListQuery>(key: K, v: PurchaseRequestListQuery[K]) {
    onChange({ ...value, [key]: v, page: 1 });
  }

  // requestNumber is an exact-match backend filter (never `contains`), so
  // committing it on every keystroke would fire a full refetch per character
  // that is guaranteed to return zero rows until the number is complete.
  // Debounced the same way ProductPicker already debounces its search.
  const [numberDraft, setNumberDraft] = useState(value.requestNumber ?? "");
  useEffect(() => setNumberDraft(value.requestNumber ?? ""), [value.requestNumber]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  function onNumberChange(v: string) {
    setNumberDraft(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => set("requestNumber", v || undefined), 300);
  }
  useEffect(() => () => clearTimeout(debounceRef.current), []);

  return (
    <div className="filter-bar">
      <div className="field grow">
        <label htmlFor="f-number">Номер заявки</label>
        <input
          id="f-number"
          placeholder="PR-2026-000123"
          value={numberDraft}
          onChange={(e) => onNumberChange(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="f-status">Статус</label>
        <select id="f-status" value={value.status ?? ""} onChange={(e) => set("status", (e.target.value || undefined) as PurchaseRequestStatus | undefined)}>
          <option value="">Все статусы</option>
          {STATUS_OPTIONS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="f-priority">Приоритет</label>
        <select id="f-priority" value={value.priority ?? ""} onChange={(e) => set("priority", (e.target.value || undefined) as PurchaseRequestPriority | undefined)}>
          <option value="">Любой</option>
          {PRIORITY_OPTIONS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="f-required">Требуемая дата</label>
        <input id="f-required" type="date" value={value.requiredDate?.slice(0, 10) ?? ""} onChange={(e) => set("requiredDate", e.target.value ? new Date(`${e.target.value}T00:00:00.000Z`).toISOString() : undefined)} />
      </div>
      <div className="field">
        <label htmlFor="f-from">Создана с</label>
        <input id="f-from" type="date" value={value.createdAtFrom?.slice(0, 10) ?? ""} onChange={(e) => set("createdAtFrom", e.target.value ? new Date(`${e.target.value}T00:00:00.000Z`).toISOString() : undefined)} />
      </div>
      <div className="field">
        <label htmlFor="f-to">по</label>
        <input id="f-to" type="date" value={value.createdAtTo?.slice(0, 10) ?? ""} onChange={(e) => set("createdAtTo", e.target.value ? new Date(`${e.target.value}T23:59:59.999Z`).toISOString() : undefined)} />
      </div>
    </div>
  );
}
