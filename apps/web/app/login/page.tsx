"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth-context";
import { ApiError } from "../../lib/api-client";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      router.push("/dashboard");
    } catch (err) {
      // Deliberately generic — the API itself never distinguishes "wrong
      // password" from "no such user" either, see AuthService.login.
      setError(err instanceof ApiError ? err.message : "Не удалось войти. Попробуйте ещё раз.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page-center">
      <form className="auth-card" onSubmit={onSubmit}>
        <h1>Вход</h1>
        <p className="muted" style={{ marginBottom: "1.25rem" }}>
          Войдите в свой аккаунт TOP Procurement
        </p>

        {error && <div className="form-error">{error}</div>}

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
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <button type="submit" className="btn" disabled={submitting}>
          {submitting ? "Вход…" : "Войти"}
        </button>

        <p className="auth-switch">
          Нет аккаунта? <Link href="/register">Создать организацию</Link>
        </p>
      </form>
    </main>
  );
}
