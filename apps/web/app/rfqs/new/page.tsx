"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { PurchaseRequestListItem, PurchaseRequestStatus, PurchaseRequestSummary } from "@top/types";
import { ProtectedRoute } from "../../../components/protected-route";
import { AppShell } from "../../../components/app-shell";
import { PrSelector } from "../../../components/rfqs/pr-selector";
import { PrItemPicker } from "../../../components/rfqs/pr-item-picker";
import { SupplierPicker } from "../../../components/rfqs/supplier-picker";
import { api, ApiError } from "../../../lib/api-client";
import { STATUS_LABELS } from "../../../lib/pr-labels";
import { useAuth } from "../../../lib/auth-context";
import { canCreateRfq } from "../../../lib/rfq-permissions";
import {
  EMPTY_RFQ_CREATE_FORM,
  buildCreateRfqPayload,
  fingerprintRfqCreateForm,
  shouldRegenerateIdempotencyKey,
  validateRfqCreateForm,
  type RfqCreateFormState,
} from "../../../lib/rfq-payload";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Same eligibility set as the backend (Revision 1 D2/§12) — UX gating only, re-checked here because `PrSelector` already guarantees it structurally but a URL-supplied `purchaseRequestId` does not (Phase E §13). */
const RFQ_ELIGIBLE_PR_STATUSES: PurchaseRequestStatus[] = ["APPROVED", "RFQ_IN_PROGRESS"];

export default function NewRfqPage() {
  return (
    <ProtectedRoute>
      <AppShell>
        <NewRfqContent />
      </AppShell>
    </ProtectedRoute>
  );
}

function NewRfqContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  // `ProtectedRoute` (unchanged) already guarantees `user` is resolved
  // (non-null) by the time this component mounts — it only renders its
  // children once `loading` is false and `user` exists, so there is no
  // separate "auth still loading" flash to handle here (Phase E final fix §8).
  // This is a page-level UX gate only, reusing the existing `canCreateRfq`
  // helper — the backend `RolesGuard` on `POST /rfqs` remains the real
  // authorization authority regardless (§6-§9).
  const unauthorized = !user || !canCreateRfq(user.role);

  // An invalid/malformed id is simply treated as "not preselected" — never a
  // crash, never a malformed request repeatedly hitting the backend (Phase D §89).
  const rawPrId = searchParams.get("purchaseRequestId");
  const initialPrId = rawPrId && UUID_RE.test(rawPrId) ? rawPrId : null;

  const [pr, setPr] = useState<PurchaseRequestSummary | null>(null);
  const [prLoadError, setPrLoadError] = useState<string | null>(null);
  const [prLoading, setPrLoading] = useState(!!initialPrId);

  const [form, setForm] = useState<RfqCreateFormState>(EMPTY_RFQ_CREATE_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One stable idempotency key per logical create ATTEMPT, never regenerated
  // merely on re-render (same base discipline as purchase-requests/new and
  // suppliers/new) — but a retry after failure only reuses it while the
  // BUSINESS payload is unchanged (Phase E §5). `lastFingerprintRef` records
  // what was actually submitted last; a fingerprint mismatch on the next
  // submit means the user edited the form since the failed attempt, so a
  // fresh key is minted right before that submit (never reused for a
  // genuinely different payload, which the backend would otherwise reject
  // with a confusing 409).
  const idempotencyKeyRef = useRef<string>();
  if (!idempotencyKeyRef.current) idempotencyKeyRef.current = crypto.randomUUID();
  const lastFingerprintRef = useRef<string | null>(null);

  /**
   * `PrSelector` only ever offers APPROVED/RFQ_IN_PROGRESS rows, so a
   * selection made through it is eligible by construction. A URL-supplied
   * `purchaseRequestId` carries no such guarantee — the PR could since have
   * moved to any other status (or never been eligible at all) — so this is
   * the one path that re-checks eligibility client-side before silently
   * treating it as selected (Phase E §13). The backend remains the final
   * authority at actual create time regardless.
   */
  function loadPr(id: string) {
    setPrLoading(true);
    setPrLoadError(null);
    api.purchaseRequests
      .get(id)
      .then((loaded) => {
        if (!RFQ_ELIGIBLE_PR_STATUSES.includes(loaded.status)) {
          setPrLoadError(
            `Заявка ${loaded.requestNumber} сейчас в статусе «${STATUS_LABELS[loaded.status]}» — RFQ можно создать только для заявки в статусе «Одобрено» или «Формирование запроса цен». Выберите другую заявку ниже.`
          );
          return;
        }
        setPr(loaded);
        setForm((f) => ({ ...f, purchaseRequestId: loaded.id, purchaseRequestItemIds: loaded.items.map((i) => i.id) }));
      })
      .catch((err) => setPrLoadError(err instanceof ApiError ? err.message : "Не удалось загрузить заявку"))
      .finally(() => setPrLoading(false));
  }

  useEffect(() => {
    // No fetch is initiated at all once the role is known to be unauthorized
    // (Phase E final fix §7) — not even the preselected-PR lookup.
    if (!initialPrId || unauthorized) return;
    loadPr(initialPrId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrId, unauthorized]);

  function selectPr(item: PurchaseRequestListItem) {
    loadPr(item.id);
  }

  async function onSubmit() {
    const validationError = validateRfqCreateForm(form);
    if (validationError) {
      setError(validationError);
      return;
    }

    const fingerprint = fingerprintRfqCreateForm(form);
    if (shouldRegenerateIdempotencyKey(lastFingerprintRef.current, fingerprint)) {
      idempotencyKeyRef.current = crypto.randomUUID();
    }
    lastFingerprintRef.current = fingerprint;

    setSubmitting(true);
    setError(null);
    try {
      const created = await api.rfqs.create(buildCreateRfqPayload(form, idempotencyKeyRef.current));
      router.push(`/rfqs/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось создать RFQ");
      setSubmitting(false);
    }
  }

  if (unauthorized) {
    return (
      <>
        <div className="page-header">
          <h1>Новый RFQ</h1>
        </div>
        <div className="form-error">Недостаточно прав для создания RFQ.</div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <h1>Новый RFQ</h1>
      </div>

      {error && <div className="form-error">{error}</div>}

      <div className="card">
        <div className="card-header">
          <h2 style={{ margin: 0 }}>Источник — заявка</h2>
        </div>
        {prLoadError && <div className="form-error">{prLoadError}</div>}
        {prLoading && <p className="muted">Загрузка…</p>}
        {!prLoading && !pr && <PrSelector onSelect={selectPr} />}
        {!prLoading && pr && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
            <div>
              <div className="item-row-name">{pr.requestNumber}</div>
              <div className="item-row-meta">
                {pr.items.length} поз. {pr.reason && <>· {pr.reason}</>}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={() => {
                setPr(null);
                setForm((f) => ({ ...f, purchaseRequestId: "", purchaseRequestItemIds: [] }));
              }}
            >
              Изменить
            </button>
          </div>
        )}
      </div>

      {pr && (
        <>
          <div className="card">
            <div className="card-header">
              <h2 style={{ margin: 0 }}>Позиции</h2>
            </div>
            <PrItemPicker
              purchaseRequestId={pr.id}
              excludeItemIds={[]}
              selected={form.purchaseRequestItemIds}
              onChange={(ids) => setForm((f) => ({ ...f, purchaseRequestItemIds: ids }))}
            />
          </div>

          <div className="card">
            <div className="card-header">
              <h2 style={{ margin: 0 }}>Поставщики</h2>
            </div>
            <SupplierPicker selected={form.supplierIds} onChange={(ids) => setForm((f) => ({ ...f, supplierIds: ids }))} />
          </div>

          <div className="card">
            <div className="card-header">
              <h2 style={{ margin: 0 }}>Срок ответа</h2>
            </div>
            <div className="field">
              <label htmlFor="new-rfq-deadline">Срок ответа поставщиков</label>
              <input
                id="new-rfq-deadline"
                type="datetime-local"
                value={form.deadline}
                onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))}
              />
              <p className="muted" style={{ fontSize: "0.78rem", marginTop: "0.2rem" }}>
                Необязательно на этапе черновика — можно указать позже, до отправки.
              </p>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h2 style={{ margin: 0 }}>Инструкции поставщику</h2>
            </div>
            <div className="field">
              <label htmlFor="new-rfq-instructions">Инструкции поставщику</label>
              <textarea
                id="new-rfq-instructions"
                rows={3}
                value={form.supplierInstructions}
                onChange={(e) => setForm((f) => ({ ...f, supplierInstructions: e.target.value }))}
              />
              <p className="muted" style={{ fontSize: "0.78rem", marginTop: "0.2rem" }}>
                Эта информация предназначена для поставщиков.
              </p>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h2 style={{ margin: 0 }}>Внутренние заметки</h2>
            </div>
            <div className="field">
              <label htmlFor="new-rfq-notes">Внутренние заметки</label>
              <textarea
                id="new-rfq-notes"
                rows={3}
                value={form.internalNotes}
                onChange={(e) => setForm((f) => ({ ...f, internalNotes: e.target.value }))}
              />
              <p className="muted" style={{ fontSize: "0.78rem", marginTop: "0.2rem" }}>
                Эти заметки видны только сотрудникам вашей организации.
              </p>
            </div>
          </div>

          <button type="button" className="btn" style={{ width: "auto" }} disabled={submitting} onClick={onSubmit}>
            {submitting ? "Сохранение…" : "Сохранить черновик"}
          </button>
        </>
      )}
    </>
  );
}
