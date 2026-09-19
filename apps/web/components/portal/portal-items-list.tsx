import type { SupplierPortalRfqItemView } from "@top/types";
import { TechnicalSpec } from "../rfqs/technical-spec";
import { formatBusinessDate, formatUom } from "../../lib/pr-labels";

/**
 * M3.4 Phase D §8/§9/§33/§34 — always-visible RFQ item info (name/SKU/
 * description/quantity/UOM/technical spec/required date), reusing the exact
 * `TechnicalSpec` renderer already proven safe for nested/array/null/
 * unexpected JSON shapes (apps/web/components/rfqs/technical-spec.tsx) — no
 * new spec-rendering logic invented. Responsive table/cards pair, same
 * pattern as the internal RFQ/Supplier/PR list pages (`rfq-table-wrap`/
 * `rfq-cards`), verified safe down to 375px (Phase D §33).
 */
export function PortalItemsList({ items }: { items: SupplierPortalRfqItemView[] }) {
  return (
    <div className="card">
      <div className="card-header">
        <h2 style={{ margin: 0 }}>Позиции</h2>
      </div>

      <div className="portal-items-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Наименование</th>
              <th>Кол-во</th>
              <th>Требуется к</th>
              <th>Описание / спецификация</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  {item.itemName}
                  {item.skuSnapshot && <div className="muted">SKU: {item.skuSnapshot}</div>}
                </td>
                <td>
                  {item.quantity} {formatUom(item.uomCode)}
                </td>
                <td>{formatBusinessDate(item.requiredDate)}</td>
                <td>
                  {item.description && <div>{item.description}</div>}
                  <TechnicalSpec spec={item.technicalSpec} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="portal-item-cards">
        {items.map((item) => (
          <div className="portal-item-card" key={item.id}>
            <div className="portal-item-card-top">
              <strong>{item.itemName}</strong>
              <span className="muted">
                {item.quantity} {formatUom(item.uomCode)}
              </span>
            </div>
            {item.skuSnapshot && <div className="muted">SKU: {item.skuSnapshot}</div>}
            {item.requiredDate && <div className="muted">Требуется к: {formatBusinessDate(item.requiredDate)}</div>}
            {item.description && <div style={{ marginTop: "0.3rem" }}>{item.description}</div>}
            <TechnicalSpec spec={item.technicalSpec} />
          </div>
        ))}
      </div>
    </div>
  );
}
