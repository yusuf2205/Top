"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import type { SupplierDetail } from "@top/types";
import { ProtectedRoute } from "../../../components/protected-route";
import { AppShell } from "../../../components/app-shell";
import { SupplierStatusBadge } from "../../../components/suppliers/supplier-status-badge";
import { SupplierStatusDialog } from "../../../components/suppliers/supplier-status-dialog";
import { SupplierGeneralInfo } from "../../../components/suppliers/supplier-general-info";
import { SupplierContacts } from "../../../components/suppliers/supplier-contacts";
import { SupplierCapabilities } from "../../../components/suppliers/supplier-capabilities";
import { SupplierRating } from "../../../components/suppliers/supplier-rating";
import { SkeletonRows, ErrorState } from "../../../components/list-states";
import { useAuth } from "../../../lib/auth-context";
import { formatSupplierRating } from "../../../lib/supplier-labels";
import { api, ApiError } from "../../../lib/api-client";
import { canChangeSupplierStatus, canEditSupplier, canManageCategories, canManageSupplierCapabilities, canManageSupplierContacts, canRateSupplier } from "../../../lib/supplier-permissions";

export default function SupplierDetailPage() {
  return (
    <ProtectedRoute>
      <AppShell>
        <SupplierDetailContent />
      </AppShell>
    </ProtectedRoute>
  );
}

function SupplierDetailContent() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();

  const [supplier, setSupplier] = useState<SupplierDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);

  // Phase E hardening (§33): the App Router reuses this component instance
  // across /suppliers/A -> /suppliers/B (same [id] pattern, no remount), so
  // a slow response for the OLD id could otherwise resolve after a faster
  // response for the NEW id and overwrite it with stale data.
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const data = await api.suppliers.get(id);
      if (seq !== requestSeq.current) return;
      setSupplier(data);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      if (err instanceof ApiError && err.statusCode === 404) {
        setNotFound(true);
      } else {
        setError(err instanceof ApiError ? err.message : "Не удалось загрузить поставщика");
      }
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (notFound) {
    return (
      <div className="empty-state">
        <h3>Поставщик не найден.</h3>
      </div>
    );
  }

  if (error) return <ErrorState message={error} onRetry={load} />;

  if (loading || !supplier || !user) return <SkeletonRows count={4} />;

  const role = user.role;

  return (
    <>
      <div className="pr-detail-header">
        <div>
          <div className="pr-detail-title">
            <h1>{supplier.companyName}</h1>
            <SupplierStatusBadge status={supplier.status} />
          </div>
          <p className="muted" style={{ marginTop: "0.3rem" }}>
            {supplier.supplierCode} · {formatSupplierRating(supplier.rating)}
          </p>
        </div>
        {canChangeSupplierStatus(role) && (
          <div className="pr-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setStatusDialogOpen(true)}>
              Изменить статус
            </button>
          </div>
        )}
      </div>

      <SupplierGeneralInfo supplier={supplier} editable={canEditSupplier(role)} onSaved={setSupplier} />

      <SupplierContacts supplier={supplier} editable={canManageSupplierContacts(role)} onChanged={setSupplier} />

      <SupplierCapabilities
        supplier={supplier}
        editable={canManageSupplierCapabilities(role)}
        canManageCategoriesFlag={canManageCategories(role)}
        onChanged={setSupplier}
      />

      <SupplierRating supplier={supplier} editable={canRateSupplier(role)} onSaved={setSupplier} />

      {statusDialogOpen && (
        <SupplierStatusDialog
          supplier={supplier}
          onClose={() => setStatusDialogOpen(false)}
          onSuccess={(updated) => {
            setSupplier(updated);
            setStatusDialogOpen(false);
          }}
        />
      )}
    </>
  );
}
