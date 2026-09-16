import type { PurchaseRequestStatus } from "@top/types";
import { STATUS_LABELS, statusClassName } from "../../lib/pr-labels";

export function PurchaseRequestStatusBadge({ status }: { status: PurchaseRequestStatus }) {
  return <span className={`status-badge ${statusClassName(status)}`}>{STATUS_LABELS[status]}</span>;
}
