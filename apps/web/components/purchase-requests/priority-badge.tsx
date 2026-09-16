import type { PurchaseRequestPriority } from "@top/types";
import { PRIORITY_LABELS, priorityClassName } from "../../lib/pr-labels";

export function PurchaseRequestPriorityBadge({ priority }: { priority: PurchaseRequestPriority }) {
  const cls = priorityClassName(priority);
  return <span className={`priority-badge ${cls}`}>{PRIORITY_LABELS[priority]}</span>;
}
