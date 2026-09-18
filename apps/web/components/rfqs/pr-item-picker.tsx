"use client";

import { useEffect, useRef, useState } from "react";
import type { PurchaseRequestItemSummary } from "@top/types";
import { api, ApiError } from "../../lib/api-client";
import { formatBusinessDate, formatUom } from "../../lib/pr-labels";

/**
 * Checkbox multi-select over a single source Purchase Request's own items
 * (Phase D §20/§43). Loaded via the existing PR detail endpoint — no RFQ
 * preview endpoint invented (§80). Used both by the create form (select the
 * initial item set) and the RFQ detail page's DRAFT "add item" flow (select
 * items not yet on the RFQ) — `excludeItemIds` hides/disables whichever ones
 * are already selected/added so the same list never offers a duplicate.
 *
 * No quantity/UOM edit here (§73/§74) — the line is a yes/no selection of
 * the full source item, snapshotted server-side exactly as-is.
 */
export function PrItemPicker({
  purchaseRequestId,
  excludeItemIds,
  selected,
  onChange,
}: {
  purchaseRequestId: string;
  excludeItemIds: string[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [items, setItems] = useState<PurchaseRequestItemSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    api.purchaseRequests
      .get(purchaseRequestId)
      .then((pr) => {
        if (seq !== requestSeq.current) return;
        setItems(pr.items);
      })
      .catch((err) => {
        if (seq !== requestSeq.current) return;
        setError(err instanceof ApiError ? err.message : "Не удалось загрузить позиции заявки");
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
  }, [purchaseRequestId]);

  const excludeSet = new Set(excludeItemIds);
  const selectedSet = new Set(selected);
  const available = items.filter((i) => !excludeSet.has(i.id));

  function toggle(id: string) {
    onChange(selectedSet.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  if (loading) return <p className="muted">Загрузка позиций…</p>;
  if (error) return <div className="form-error">{error}</div>;
  if (available.length === 0) return <p className="muted">Нет доступных позиций для добавления.</p>;

  return (
    <div className="picker-list">
      {available.map((item) => (
        <label key={item.id} className="picker-row" style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={selectedSet.has(item.id)} onChange={() => toggle(item.id)} />
          <div className="picker-row-main">
            <div className="item-row-name">
              {item.itemName}
              {item.skuSnapshot && <span className="muted"> · SKU: {item.skuSnapshot}</span>}
            </div>
            <div className="item-row-meta">
              {Number(item.quantity)} {formatUom(item.uomCode)}
              {item.requiredDate && <> · к {formatBusinessDate(item.requiredDate)}</>}
              {item.description && <> · {item.description}</>}
            </div>
          </div>
        </label>
      ))}
    </div>
  );
}
