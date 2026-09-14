"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { OrganizationMember, PendingInvitation, UserRole } from "@top/types";
import { ProtectedRoute } from "../../../components/protected-route";
import { AppShell } from "../../../components/app-shell";
import { useAuth } from "../../../lib/auth-context";
import { api, ApiError } from "../../../lib/api-client";

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "ADMIN", label: "Администратор" },
  { value: "PROCUREMENT_MANAGER", label: "Менеджер закупок" },
  { value: "PROCUREMENT_SPECIALIST", label: "Специалист по закупкам" },
  { value: "APPROVER", label: "Согласующий" },
  { value: "EMPLOYEE", label: "Сотрудник" },
];

export default function MembersSettingsPage() {
  return (
    <ProtectedRoute>
      <AppShell>
        <MembersSettingsContent />
      </AppShell>
    </ProtectedRoute>
  );
}

function MembersSettingsContent() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("EMPLOYEE");
  const [inviting, setInviting] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [m, i] = await Promise.all([
        api.members.list(),
        isAdmin ? api.members.listInvitations() : Promise.resolve([]),
      ]);
      setMembers(m);
      setInvitations(i);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось загрузить список");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    setInviting(true);
    setError(null);
    setInviteLink(null);
    try {
      const { rawToken } = await api.members.invite({ email: inviteEmail, role: inviteRole });
      setInviteLink(`${window.location.origin}/invite/${rawToken}`);
      setInviteEmail("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отправить приглашение");
    } finally {
      setInviting(false);
    }
  }

  async function onRoleChange(userId: string, role: UserRole) {
    setError(null);
    try {
      await api.members.updateRole(userId, role);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось изменить роль");
    }
  }

  async function onRemove(userId: string) {
    if (!confirm("Удалить сотрудника из организации?")) return;
    setError(null);
    try {
      await api.members.remove(userId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось удалить сотрудника");
    }
  }

  async function onRevokeInvitation(id: string) {
    setError(null);
    try {
      await api.members.revokeInvitation(id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отозвать приглашение");
    }
  }

  return (
    <>
      <h1>Сотрудники</h1>
      {error && <div className="form-error">{error}</div>}

      {isAdmin && (
        <div className="card">
          <div className="card-header">
            <h2 style={{ margin: 0 }}>Пригласить сотрудника</h2>
          </div>
          {inviteLink && (
            <div className="form-success">
              Приглашение создано. Отправьте эту ссылку сотруднику вручную (email пока не настроен):
              <br />
              <code style={{ wordBreak: "break-all" }}>{inviteLink}</code>
            </div>
          )}
          <form className="inline-form" onSubmit={onInvite}>
            <div className="field">
              <label htmlFor="inviteEmail">Email</label>
              <input
                id="inviteEmail"
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="inviteRole">Роль</label>
              <select id="inviteRole" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as UserRole)}>
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn btn-secondary" disabled={inviting}>
              {inviting ? "Отправка…" : "Пригласить"}
            </button>
          </form>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <h2 style={{ margin: 0 }}>Участники</h2>
        </div>
        {loading ? (
          <p className="muted">Загрузка…</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Имя</th>
                <th>Email</th>
                <th>Роль</th>
                <th>Статус</th>
                {isAdmin && <th />}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>{m.fullName}</td>
                  <td>{m.email}</td>
                  <td>
                    {isAdmin && m.id !== user?.id ? (
                      <select value={m.role} onChange={(e) => onRoleChange(m.id, e.target.value as UserRole)}>
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className={`badge ${m.role === "ADMIN" ? "badge-admin" : ""}`}>
                        {ROLE_OPTIONS.find((r) => r.value === m.role)?.label ?? m.role}
                      </span>
                    )}
                  </td>
                  <td>{m.active ? "Активен" : "Отключён"}</td>
                  {isAdmin && (
                    <td>
                      {m.id !== user?.id && m.active && (
                        <button className="btn btn-danger btn-small" onClick={() => onRemove(m.id)}>
                          Удалить
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {isAdmin && invitations.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2 style={{ margin: 0 }}>Ожидающие приглашения</h2>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Роль</th>
                <th>Истекает</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {invitations.map((i) => (
                <tr key={i.id}>
                  <td>{i.email}</td>
                  <td>{ROLE_OPTIONS.find((r) => r.value === i.role)?.label ?? i.role}</td>
                  <td>{new Date(i.expiresAt).toLocaleDateString("ru-RU")}</td>
                  <td>
                    <button className="btn btn-secondary btn-small" onClick={() => onRevokeInvitation(i.id)}>
                      Отозвать
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
