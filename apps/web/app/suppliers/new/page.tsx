"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ProtectedRoute } from "../../../components/protected-route";
import { AppShell } from "../../../components/app-shell";
import { SupplierFormFields } from "../../../components/suppliers/supplier-form";
import { EMPTY_SUPPLIER_CREATE_FORM, buildCreateSupplierPayload, validateSupplierCreateForm, type SupplierFormState } from "../../../lib/supplier-payload";
import { api, ApiError } from "../../../lib/api-client";

export default function NewSupplierPage() {
  return (
    <ProtectedRoute>
      <AppShell>
        <NewSupplierContent />
      </AppShell>
    </ProtectedRoute>
  );
}

function NewSupplierContent() {
  const router = useRouter();
  const [state, setState] = useState<SupplierFormState>(EMPTY_SUPPLIER_CREATE_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One stable idempotency key per logical create attempt — never
  // regenerated on re-render or on retry after a failure (Phase D §20,
  // same pattern as purchase-requests/new/page.tsx). A genuinely new
  // attempt only starts by navigating away and back, which remounts this
  // page and creates a fresh key.
  const idempotencyKeyRef = useRef<string>();
  if (!idempotencyKeyRef.current) idempotencyKeyRef.current = crypto.randomUUID();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const validationError = validateSupplierCreateForm(state);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.suppliers.create(buildCreateSupplierPayload(state, idempotencyKeyRef.current));
      router.push(`/suppliers/${created.id}`);
    } catch (err) {
      // Respect the backend's own message — a 409 here may be either a
      // genuine duplicate-TIN business rejection or an idempotency-key
      // conflict, and the two carry different messages (Phase D §22).
      setError(err instanceof ApiError ? err.message : "Не удалось создать поставщика");
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <h1>Новый поставщик</h1>
      </div>

      <form onSubmit={onSubmit} className="card">
        {error && <div className="form-error">{error}</div>}
        <SupplierFormFields state={state} onChange={(patch) => setState((s) => ({ ...s, ...patch }))} disabled={submitting} />
        <button type="submit" className="btn" style={{ width: "auto" }} disabled={submitting}>
          {submitting ? "Создание…" : "Создать поставщика"}
        </button>
      </form>
    </>
  );
}
