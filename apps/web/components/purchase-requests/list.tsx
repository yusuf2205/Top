import Link from "next/link";
import type { PurchaseRequestListItem } from "@top/types";
import { PurchaseRequestStatusBadge } from "./status-badge";
import { PurchaseRequestPriorityBadge } from "./priority-badge";
import { formatBusinessDate, formatDate } from "../../lib/pr-labels";
import type { MemberLookup } from "../../lib/member-lookup";

export function PurchaseRequestList({ items, resolveUser }: { items: PurchaseRequestListItem[]; resolveUser: MemberLookup }) {
  return (
    <>
      <div className="pr-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Номер</th>
              <th>Статус</th>
              <th>Приоритет</th>
              <th>Инициатор</th>
              <th>Закупщик</th>
              <th>Требуемая дата</th>
              <th>Позиций</th>
              <th>Создана</th>
            </tr>
          </thead>
          <tbody>
            {items.map((pr) => (
              <tr key={pr.id}>
                <td>
                  <Link href={`/purchase-requests/${pr.id}`} className="pr-number">
                    {pr.requestNumber}
                  </Link>
                </td>
                <td>
                  <PurchaseRequestStatusBadge status={pr.status} />
                </td>
                <td>
                  <PurchaseRequestPriorityBadge priority={pr.priority} />
                </td>
                <td>{resolveUser(pr.requesterId)}</td>
                <td>{pr.assignedBuyerUserId ? resolveUser(pr.assignedBuyerUserId) : "—"}</td>
                <td>{formatBusinessDate(pr.requiredDate)}</td>
                <td>{pr.itemCount}</td>
                <td>{formatDate(pr.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pr-cards">
        {items.map((pr) => (
          <Link href={`/purchase-requests/${pr.id}`} key={pr.id} className="pr-card" style={{ display: "block", color: "inherit" }}>
            <div className="pr-card-top">
              <span className="pr-number">{pr.requestNumber}</span>
              <PurchaseRequestStatusBadge status={pr.status} />
            </div>
            <div className="pr-card-meta">
              <PurchaseRequestPriorityBadge priority={pr.priority} />
              <span>к {formatBusinessDate(pr.requiredDate)}</span>
              <span>{pr.itemCount} поз.</span>
              <span>{resolveUser(pr.requesterId)}</span>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
