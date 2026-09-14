"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ProtectedRoute } from "../../../components/protected-route";
import { AppShell } from "../../../components/app-shell";
import { useAuth } from "../../../lib/auth-context";
import { api, ApiError } from "../../../lib/api-client";

interface OrgForm {
  name: string;
  legalName: string;
  tin: string;
}

export default function OrganizationSettingsPage() {
  return (
    <ProtectedRoute>
      <AppShell>
        <OrganizationSettingsContent />
      </AppShell>
    </ProtectedRoute>
  );
}

function OrganizationSettingsContent() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [form, setForm] = useState<OrgForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    api
      .organization.getCurrent()
      .then((org) => setForm({ name: org.name, legalName: org.legalName ?? "", tin: org.tin ?? "" }))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Не удалось загрузить организацию"))
      .finally(() => setLoading(false));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await api.organization.update({ name: form.name, legalName: form.legalName, tin: form.tin });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить изменения");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="muted">Загрузка…</p>;
  if (!form) return <div className="form-error">{error ?? "Организация не найдена"}</div>;

  return (
    <>
      <h1>Организация</h1>
      <div className="card">
        <form onSubmit={onSubmit}>
          {error && <div className="form-error">{error}</div>}
          {success && <div className="form-success">Изменения сохранены</div>}

          <div className="field">
            <label htmlFor="name">Название</label>
            <input
              id="name"
              required
              disabled={!isAdmin}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor="legalName">Юридическое название</label>
            <input
              id="legalName"
              disabled={!isAdmin}
              value={form.legalName}
              onChange={(e) => setForm({ ...form, legalName: e.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor="tin">ИНН</label>
            <input
              id="tin"
              disabled={!isAdmin}
              value={form.tin}
              onChange={(e) => setForm({ ...form, tin: e.target.value })}
            />
          </div>

          {isAdmin ? (
            <button type="submit" className="btn btn-secondary" disabled={saving}>
              {saving ? "Сохранение…" : "Сохранить"}
            </button>
          ) : (
            <p className="muted">Изменять данные организации может только администратор.</p>
          )}
        </form>
      </div>
    </>
  );
}
