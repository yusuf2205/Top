import type { PurchaseRequestApprovalView } from "@top/types";
import { formatDateTime } from "../../lib/pr-labels";
import type { MemberLookup } from "../../lib/member-lookup";

const APPROVAL_STATUS_LABELS: Record<string, string> = {
  PENDING: "Ожидает решения",
  APPROVED: "Одобрено",
  REJECTED: "Отклонено",
};

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Администратор",
  PROCUREMENT_MANAGER: "Менеджер закупок",
  PROCUREMENT_SPECIALIST: "Специалист по закупкам",
  APPROVER: "Согласующий",
};

export function ApprovalCard({ approval, resolveUser }: { approval: PurchaseRequestApprovalView; resolveUser: MemberLookup }) {
  const step = approval.step;
  return (
    <div className="card approval-card">
      <div className="card-header">
        <h2 style={{ margin: 0 }}>Согласование</h2>
      </div>
      <div className="meta-grid">
        <div>
          <div className="meta-label">Статус</div>
          <div className="meta-value">{APPROVAL_STATUS_LABELS[approval.status] ?? approval.status}</div>
        </div>
        {step && (
          <div>
            <div className="meta-label">Роль согласующего</div>
            <div className="meta-value">{ROLE_LABELS[step.approverRole] ?? step.approverRole}</div>
          </div>
        )}
        {step && step.status === "PENDING" && (
          <div>
            <div className="meta-label">Решение</div>
            <div className="meta-value decision-pending">Ожидает решения</div>
          </div>
        )}
        {step && step.decidedById && (
          <div>
            <div className="meta-label">Кем принято решение</div>
            <div className="meta-value">{resolveUser(step.decidedById)}</div>
          </div>
        )}
        {step && step.decidedAt && (
          <div>
            <div className="meta-label">Дата решения</div>
            <div className="meta-value">{formatDateTime(step.decidedAt)}</div>
          </div>
        )}
        {step && step.comment && (
          <div style={{ gridColumn: "1 / -1" }}>
            <div className="meta-label">Комментарий</div>
            <div className="meta-value">{step.comment}</div>
          </div>
        )}
      </div>
    </div>
  );
}
