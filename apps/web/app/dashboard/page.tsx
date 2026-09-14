"use client";

import { ProtectedRoute } from "../../components/protected-route";
import { AppShell } from "../../components/app-shell";
import { useAuth } from "../../lib/auth-context";

export default function DashboardPage() {
  return (
    <ProtectedRoute>
      <AppShell>
        <DashboardContent />
      </AppShell>
    </ProtectedRoute>
  );
}

function DashboardContent() {
  const { user } = useAuth();
  return (
    <>
      <h1>Дашборд</h1>
      <p className="muted" style={{ marginBottom: "1.5rem" }}>
        Добро пожаловать, {user?.fullName}.
      </p>
      <div className="card">
        <div className="card-header">
          <h2 style={{ margin: 0 }}>M1 готов</h2>
        </div>
        <p className="muted">
          Аутентификация, RBAC и управление организацией настроены. Модули закупок (Purchase Request, RFQ, поставщики
          и т.д.) будут добавлены в следующих этапах.
        </p>
      </div>
    </>
  );
}
