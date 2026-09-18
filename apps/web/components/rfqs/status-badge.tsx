import type { RfqStatus, RfqSupplierStatus } from "@top/types";
import { RFQ_STATUS_LABELS, RFQ_SUPPLIER_STATUS_LABELS, rfqStatusClassName, rfqSupplierStatusClassName } from "../../lib/rfq-labels";

export function RfqStatusBadge({ status }: { status: RfqStatus }) {
  return <span className={`status-badge ${rfqStatusClassName(status)}`}>{RFQ_STATUS_LABELS[status] ?? status}</span>;
}

export function RfqSupplierStatusBadge({ status }: { status: RfqSupplierStatus }) {
  return <span className={`status-badge ${rfqSupplierStatusClassName(status)}`}>{RFQ_SUPPLIER_STATUS_LABELS[status] ?? status}</span>;
}
