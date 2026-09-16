"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { PurchaseRequestPriority } from "@top/types";
import type { CreatePurchaseRequestInput } from "@top/validation";
import { ProtectedRoute } from "../../../components/protected-route";
import { AppShell } from "../../../components/app-shell";
import { ItemEditor } from "../../../components/purchase-requests/item-editor";
import { PRIORITY_LABELS, formatUom } from "../../../lib/pr-labels";
import { buildItemInput, type ItemFormState } from "../../../lib/pr-item-payload";
import { api, ApiError } from "../../../lib/api-client";

const PRIORITY_OPTIONS = Object.entries(PRIORITY_LABELS) as [PurchaseRequestPriority, string][];

export default function NewPurchaseRequestPage() {
  return (
    <ProtectedRoute>
      <AppShell>
        <NewPurchaseRequestContent />
      </AppShell>
    </ProtectedRoute>
  );
}

function NewPurchaseRequestContent() {
  const router = useRouter();

  const [priority, setPriority] = useState<PurchaseRequestPriority>("NORMAL");
  const [requiredDate, setRequiredDate] = useState("");
  const [reason, setReason] = useState("");
  const [estimatedBudget, setEstimatedBudget] = useState("");
  const [currency, setCurrency] = useState("UZS");

  const [items, setItems] = useState<ItemFormState[]>([]);
  const [addingItem, setAddingItem] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One stable idempotency key per logical create attempt — never
  // regenerated on re-render, so retrying after a network-uncertain failure
  // reuses the same key (a genuinely new attempt only starts on navigating
  // away and back, which remounts this page and creates a fresh key).
  const idempotencyKeyRef = useRef<string>();
  if (!idempotencyKeyRef.current) idempotencyKeyRef.current = crypto.randomUUID();

  function addItem(state: ItemFormState) {
    setItems((prev) => [...prev, state]);
    setAddingItem(false);
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (items.length === 0) {
      setError("Добавьте хотя бы одну позицию.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const input: CreatePurchaseRequestInput = {
        priority,
        requiredDate: requiredDate ? new Date(`${requiredDate}T00:00:00.000Z`).toISOString() : undefined,
        reason: reason.trim() || undefined,
        estimatedBudget: estimatedBudget.trim() || undefined,
        currency: currency.trim() || undefined,
        idempotencyKey: idempotencyKeyRef.current,
        items: items.map(buildItemInput),
      };
      const created = await api.purchaseRequests.create(input);
      router.push(`/purchase-requests/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось создать заявку");
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <h1>Новая заявка на закупку</h1>
      </div>

      <form onSubmit={onSubmit}>
        {error && <div className="form-error">{error}</div>}

        <div className="card">
          <div className="card-header">
            <h2 style={{ margin: 0 }}>Основная информация</h2>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <div className="field" style={{ flex: 1, minWidth: 140 }}>
              <label htmlFor="priority">Приоритет</label>
              <select id="priority" value={priority} onChange={(e) => setPriority(e.target.value as PurchaseRequestPriority)}>
                {PRIORITY_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: 1, minWidth: 140 }}>
              <label htmlFor="requiredDate">Требуемая дата</label>
              <input id="requiredDate" type="date" value={requiredDate} onChange={(e) => setRequiredDate(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 140 }}>
              <label htmlFor="estimatedBudget">Ориентировочный бюджет</label>
              <input id="estimatedBudget" inputMode="decimal" placeholder="необязательно" value={estimatedBudget} onChange={(e) => setEstimatedBudget(e.target.value)} />
            </div>
            <div className="field" style={{ width: 100 }}>
              <label htmlFor="currency">Валюта</label>
              <input id="currency" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="reason">Обоснование</label>
            <input id="reason" placeholder="Зачем нужна закупка (необязательно)" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2 style={{ margin: 0 }}>Позиции заявки</h2>
            {!addingItem && (
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setAddingItem(true)}>
                + Добавить позицию
              </button>
            )}
          </div>

          {addingItem && <ItemEditor mode="add" submitting={false} onCancel={() => setAddingItem(false)} onSubmit={addItem} />}

          {items.length === 0 && !addingItem && <p className="muted">Позиций пока нет. Добавьте хотя бы одну перед созданием заявки.</p>}

          {items.map((item, i) => (
            <div className="item-row" key={i}>
              <div className="item-row-main">
                <div className="item-row-name">{item.mode === "product" ? item.productLabel : item.itemName}</div>
                <div className="item-row-meta">
                  {item.quantity} {item.uomCode ? formatUom(item.uomCode) : ""}
                </div>
              </div>
              <div className="item-row-actions">
                <button type="button" className="btn btn-danger btn-small" onClick={() => removeItem(i)}>
                  Удалить
                </button>
              </div>
            </div>
          ))}
        </div>

        <button type="submit" className="btn" style={{ width: "auto" }} disabled={submitting}>
          {submitting ? "Создание…" : "Создать заявку"}
        </button>
      </form>
    </>
  );
}
