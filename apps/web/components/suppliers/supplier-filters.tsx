"use client";

import { useEffect, useRef, useState } from "react";
import type { CategorySummary, SupplierStatus } from "@top/types";
import type { SupplierListQuery } from "../../lib/api-client";
import { SUPPLIER_STATUS_LABELS } from "../../lib/supplier-labels";

const STATUS_OPTIONS = Object.entries(SUPPLIER_STATUS_LABELS) as [SupplierStatus, string][];

/**
 * Search is server-side (GET /suppliers?search=), debounced ~300ms like
 * PurchaseRequestFilters' requestNumber field (Phase D §10). The status
 * selector's default/omitted state deliberately does NOT send a fake "all
 * non-archived" value — the backend's own default already excludes ARCHIVED
 * (Phase D §11), so omitting `status` reproduces that exactly.
 */
export function SupplierFilters({
  value,
  onChange,
  categories,
}: {
  value: SupplierListQuery;
  onChange: (next: SupplierListQuery) => void;
  categories: CategorySummary[];
}) {
  function set<K extends keyof SupplierListQuery>(key: K, v: SupplierListQuery[K]) {
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
        <label htmlFor="s-search">Поиск</label>
        <input
          id="s-search"
          placeholder="Название, код или ИНН"
          value={searchDraft}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="s-status">Статус</label>
        <select id="s-status" value={value.status ?? ""} onChange={(e) => set("status", (e.target.value || undefined) as SupplierStatus | undefined)}>
          <option value="">Все, кроме архива</option>
          {STATUS_OPTIONS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="s-category">Категория</label>
        <select id="s-category" value={value.categoryId ?? ""} onChange={(e) => set("categoryId", e.target.value || undefined)}>
          <option value="">Все категории</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field" style={{ width: 110 }}>
        <label htmlFor="s-country">Страна (код)</label>
        <input
          id="s-country"
          maxLength={2}
          placeholder="UZ"
          value={value.countryCode ?? ""}
          onChange={(e) => set("countryCode", e.target.value.toUpperCase() || undefined)}
        />
      </div>
    </div>
  );
}
