"use client";

import { useEffect, useState } from "react";
import type { ProductSummary } from "@top/types";
import { api } from "../../lib/api-client";

/**
 * Debounced search against the real GET /api/v1/products?search= endpoint
 * (it genuinely supports server-side search — not a client-side filter over
 * one page pretending to be global search, see the Phase A inventory).
 */
export function ProductPicker({
  selected,
  onSelect,
}: {
  selected: ProductSummary | null;
  onSelect: (product: ProductSummary | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      api.products
        .list({ search: query.trim(), pageSize: 20 })
        .then((res) => !cancelled && setResults(res.items))
        .catch(() => !cancelled && setResults([]))
        .finally(() => !cancelled && setLoading(false));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open]);

  if (selected) {
    return (
      <div className="field">
        <label>Товар</label>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", border: "1px solid var(--color-border)", borderRadius: 6, padding: "0.5rem 0.7rem" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500 }}>{selected.name}</div>
            <div className="muted" style={{ fontSize: "0.78rem" }}>
              SKU: {selected.sku} · база: {selected.baseUomCode}
            </div>
          </div>
          <button type="button" className="btn btn-secondary btn-small" onClick={() => onSelect(null)}>
            Изменить
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="field" style={{ position: "relative" }}>
      <label htmlFor="product-search">Товар из каталога</label>
      <input
        id="product-search"
        type="text"
        placeholder="Начните вводить название или SKU…"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => setQuery(e.target.value)}
      />
      {open && query.trim().length >= 2 && (
        <div
          className="card"
          style={{ position: "absolute", zIndex: 20, top: "100%", left: 0, right: 0, marginTop: 4, padding: "0.4rem", maxHeight: 260, overflowY: "auto" }}
        >
          {loading && <p className="muted" style={{ padding: "0.4rem" }}>Поиск…</p>}
          {!loading && results.length === 0 && <p className="muted" style={{ padding: "0.4rem" }}>Ничего не найдено</p>}
          {!loading &&
            results.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  onSelect(p);
                  setOpen(false);
                  setQuery("");
                }}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "0.45rem 0.5rem", border: "none", background: "transparent", cursor: "pointer", borderRadius: 6 }}
                onMouseDown={(e) => e.preventDefault()}
              >
                <div style={{ fontSize: "0.88rem" }}>{p.name}</div>
                <div className="muted" style={{ fontSize: "0.76rem" }}>
                  SKU: {p.sku}
                </div>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
