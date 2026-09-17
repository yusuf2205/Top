import Link from "next/link";
import type { SupplierSummary } from "@top/types";
import { SupplierStatusBadge } from "./supplier-status-badge";
import { formatCountryCode, formatSupplierRating } from "../../lib/supplier-labels";

/**
 * Renders only fields SupplierSummary actually returns (Phase D §9/§66) —
 * no "Категории"/"Основной контакт" columns, since the list response
 * carries neither and fetching them per-row would be N+1. Full context is
 * available on the detail page.
 */
export function SupplierList({ items }: { items: SupplierSummary[] }) {
  return (
    <>
      <div className="supplier-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Код</th>
              <th>Поставщик</th>
              <th>ИНН / STIR</th>
              <th>Статус</th>
              <th>Рейтинг</th>
              <th>Страна</th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id}>
                <td className="muted">{s.supplierCode}</td>
                <td>
                  <Link href={`/suppliers/${s.id}`} className="supplier-name-link">
                    {s.companyName}
                  </Link>
                </td>
                <td>{s.tin ?? "—"}</td>
                <td>
                  <SupplierStatusBadge status={s.status} />
                </td>
                <td>{formatSupplierRating(s.rating)}</td>
                <td>{formatCountryCode(s.countryCode)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="supplier-cards">
        {items.map((s) => (
          <Link href={`/suppliers/${s.id}`} key={s.id} className="supplier-card" style={{ display: "block", color: "inherit" }}>
            <div className="supplier-card-top">
              <span className="supplier-name-link">{s.companyName}</span>
              <SupplierStatusBadge status={s.status} />
            </div>
            <div className="supplier-card-meta">
              <span>{s.supplierCode}</span>
              {s.tin && <span>ИНН {s.tin}</span>}
              <span>{formatSupplierRating(s.rating)}</span>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
