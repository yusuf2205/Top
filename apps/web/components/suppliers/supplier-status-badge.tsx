import type { SupplierStatus } from "@top/types";
import { SUPPLIER_STATUS_LABELS, supplierStatusClassName } from "../../lib/supplier-labels";

export function SupplierStatusBadge({ status }: { status: SupplierStatus }) {
  return <span className={`status-badge ${supplierStatusClassName(status)}`}>{SUPPLIER_STATUS_LABELS[status]}</span>;
}
