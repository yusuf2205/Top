"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth-context";
import { ApiError } from "../../lib/api-client";

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [organizationName, setOrganizationName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await register({ organizationName, fullName, email, password });
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось создать организацию. Попробуйте ещё раз.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page-center">
      <form className="auth-card" onSubmit={onSubmit}>
        <h1>Создать организацию</h1>
        <p className="muted" style={{ marginBottom: "1.25rem" }}>
          Вы станете администратором новой организации
        </p>

        {error && <div className="form-error">{error}</div>}

        <div className="field">
          <label htmlFor="organizationName">Название организации</label>
          <input
            id="organizationName"
            required
            minLength={2}
            value={organizationName}
            onChange={(e) => setOrganizationName(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="fullName">Ваше имя</label>
          <input id="fullName" required minLength={2} value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="password">Пароль</label>
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
          {submitting ? "Создание…" : "Создать организацию"}
        </button>

        <p className="auth-switch">
          Уже есть аккаунт? <Link href="/login">Войти</Link>
        </p>
      </form>
    </main>
  );
}
