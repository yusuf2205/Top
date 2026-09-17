"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { UserRole } from "@top/types";
import { useAuth } from "../lib/auth-context";
import { RealtimeProvider, useRealtimeStatus } from "../lib/realtime";
import { canViewSuppliers } from "../lib/supplier-permissions";

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Администратор",
  PROCUREMENT_MANAGER: "Менеджер закупок",
  PROCUREMENT_SPECIALIST: "Специалист по закупкам",
  APPROVER: "Согласующий",
  EMPLOYEE: "Сотрудник",
  SUPPLIER: "Поставщик",
};

interface NavItem {
  href: string;
  label: string;
  visible?: (role: UserRole) => boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Дашборд" },
  { href: "/purchase-requests", label: "Заявки на закупку" },
  { href: "/suppliers", label: "Поставщики", visible: canViewSuppliers },
  { href: "/settings/organization", label: "Организация" },
  { href: "/settings/members", label: "Сотрудники" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  async function onLogout() {
    await logout();
    router.push("/login");
  }

  const visibleNavItems = NAV_ITEMS.filter((item) => !item.visible || (user && item.visible(user.role)));

  return (
    <RealtimeProvider>
      <div className="app-shell">
        <aside className="app-sidebar">
          <div className="brand">TOP Procurement</div>
          <nav className="app-nav">
            {visibleNavItems.map((item) => {
              const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
              return (
                <Link key={item.href} href={item.href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {user && (
            <div className="org-info">
              <div className="name">{user.organizationName}</div>
              <div className="muted">
                {user.fullName} · {ROLE_LABELS[user.role] ?? user.role}
              </div>
              <ConnectionIndicator />
              <button className="btn btn-secondary btn-small" style={{ marginTop: "0.6rem" }} onClick={onLogout}>
                Выйти
              </button>
            </div>
          )}
        </aside>
        <main className="app-main">{children}</main>
      </div>
    </RealtimeProvider>
  );
}

/**
 * Purely informational — the rest of the app never depends on this value
 * (REST remains the source of truth regardless of socket state, Phase A
 * §39/Phase B §34). Reuses the `.realtime-dot` styling already present in
 * globals.css since Phase A, which had no consumer until now.
 */
function ConnectionIndicator() {
  const connected = useRealtimeStatus();
  return (
    <div className="muted" style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "0.5rem", fontSize: "0.76rem" }}>
      <span className={connected ? "realtime-dot live" : "realtime-dot"} />
      {connected ? "Обновления в реальном времени" : "Нет соединения"}
    </div>
  );
}
