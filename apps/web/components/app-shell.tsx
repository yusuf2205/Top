"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../lib/auth-context";

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Администратор",
  PROCUREMENT_MANAGER: "Менеджер закупок",
  PROCUREMENT_SPECIALIST: "Специалист по закупкам",
  APPROVER: "Согласующий",
  EMPLOYEE: "Сотрудник",
  SUPPLIER: "Поставщик",
};

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const router = useRouter();

  async function onLogout() {
    await logout();
    router.push("/login");
  }

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="brand">TOP Procurement</div>
        <nav className="app-nav">
          <Link href="/dashboard">Дашборд</Link>
          <Link href="/settings/organization">Организация</Link>
          <Link href="/settings/members">Сотрудники</Link>
        </nav>

        {user && (
          <div className="org-info">
            <div className="name">{user.organizationName}</div>
            <div className="muted">
              {user.fullName} · {ROLE_LABELS[user.role] ?? user.role}
            </div>
            <button className="btn btn-secondary btn-small" style={{ marginTop: "0.6rem" }} onClick={onLogout}>
              Выйти
            </button>
          </div>
        )}
      </aside>
      <main className="app-main">{children}</main>
    </div>
  );
}
