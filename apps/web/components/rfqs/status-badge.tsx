import type { RfqStatus, RfqSupplierStatus } from "@top/types";
import { RFQ_STATUS_LABELS, RFQ_SUPPLIER_STATUS_LABELS, rfqStatusClassName, rfqSupplierStatusClassName } from "../../lib/rfq-labels";
import { getPortalAccessLabel, portalAccessClassName } from "../../lib/portal-access-labels";

export function RfqStatusBadge({ status }: { status: RfqStatus }) {
  return <span className={`status-badge ${rfqStatusClassName(status)}`}>{RFQ_STATUS_LABELS[status] ?? status}</span>;
}

export function RfqSupplierStatusBadge({ status }: { status: RfqSupplierStatus }) {
  return <span className={`status-badge ${rfqSupplierStatusClassName(status)}`}>{RFQ_SUPPLIER_STATUS_LABELS[status] ?? status}</span>;
}

/**
 * M3.4 Phase D §3/§16/§25/§26 — a SEPARATE badge from `RfqSupplierStatusBadge`
 * on purpose: portal credential state is independent of participation
 * status (Revoke leaves `status` unchanged), so this is always shown
 * alongside, never instead of, the participation badge.
 */
export function PortalAccessBadge({ status, active }: { status: RfqSupplierStatus; active: boolean }) {
  return <span className={`status-badge ${portalAccessClassName(status, active)}`}>{getPortalAccessLabel(status, active)}</span>;
}
