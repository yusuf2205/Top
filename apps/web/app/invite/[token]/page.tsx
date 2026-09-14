"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, ApiError } from "../../../lib/api-client";

export default function AcceptInvitationPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();

  const [info, setInfo] = useState<{ email: string; role: string; organizationName: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    api.invitations
      .getByToken(params.token)
      .then(setInfo)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Приглашение недействительно"));
  }, [params.token]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      await api.invitations.accept(params.token, { fullName, password });
      router.push("/login?invited=1");
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Не удалось принять приглашение");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <main className="page-center">
        <div className="auth-card">
          <h1>Приглашение недействительно</h1>
          <div className="form-error">{loadError}</div>
        </div>
      </main>
    );
  }

  if (!info) {
    return (
      <main className="page-center">
        <p className="muted">Загрузка…</p>
      </main>
    );
  }

  return (
    <main className="page-center">
      <form className="auth-card" onSubmit={onSubmit}>
        <h1>Присоединиться к {info.organizationName}</h1>
        <p className="muted" style={{ marginBottom: "1.25rem" }}>
          Приглашение отправлено на {info.email}
        </p>

        {submitError && <div className="form-error">{submitError}</div>}

        <div className="field">
          <label htmlFor="fullName">Ваше имя</label>
          <input id="fullName" required minLength={2} value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="password">Придумайте пароль</label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <button type="submit" className="btn" disabled={submitting}>
          {submitting ? "Создание аккаунта…" : "Принять приглашение"}
        </button>
      </form>
    </main>
  );
}
