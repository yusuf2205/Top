import Link from "next/link";
import type { RfqSummary } from "@top/types";
import { RfqStatusBadge } from "./status-badge";
import { formatDeadline, isDeadlineOverdue } from "../../lib/rfq-labels";
import { formatDate } from "../../lib/pr-labels";

/** Renders only RfqSummary fields (Phase D §8) — no per-row detail fetch, no N+1. */
export function RfqList({ items }: { items: RfqSummary[] }) {
  return (
    <>
      <div className="rfq-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>RFQ №</th>
              <th>Заявка</th>
              <th>Статус</th>
              <th>Позиций</th>
              <th>Поставщиков</th>
              <th>Срок ответа</th>
              <th>Создан</th>
            </tr>
          </thead>
          <tbody>
            {items.map((rfq) => (
              <tr key={rfq.id}>
                <td>
                  <Link href={`/rfqs/${rfq.id}`} className="rfq-number">
                    {rfq.rfqNumber}
                  </Link>
                </td>
                <td>
                  <Link href={`/purchase-requests/${rfq.purchaseRequest.id}`} className="muted">
                    {rfq.purchaseRequest.requestNumber}
                  </Link>
                </td>
                <td>
                  <RfqStatusBadge status={rfq.status} />
                </td>
                <td>{rfq.itemCount}</td>
                <td>{rfq.supplierCount}</td>
                <td>
                  {formatDeadline(rfq.deadline)}
                  {isDeadlineOverdue(rfq.status, rfq.deadline) && (
                    <>
                      {" "}
                      <span className="status-badge status-rejected">Срок истёк</span>
                    </>
                  )}
                </td>
                <td>{formatDate(rfq.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rfq-cards">
        {items.map((rfq) => (
          <Link href={`/rfqs/${rfq.id}`} key={rfq.id} className="rfq-card" style={{ display: "block", color: "inherit" }}>
            <div className="rfq-card-top">
              <span className="rfq-number">{rfq.rfqNumber}</span>
              <RfqStatusBadge status={rfq.status} />
            </div>
            <div className="rfq-card-meta">
              <span>{rfq.purchaseRequest.requestNumber}</span>
              <span>{rfq.itemCount} поз.</span>
              <span>{rfq.supplierCount} поставщ.</span>
              <span>к {formatDeadline(rfq.deadline)}</span>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
