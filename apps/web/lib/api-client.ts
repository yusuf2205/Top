import type { CurrentUser, OrganizationMember, PendingInvitation } from "@top/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * Access token lives ONLY in memory (module-level variable) — never
 * localStorage/sessionStorage, so it isn't readable by an XSS payload that
 * persists across reloads, and it disappears automatically on tab close.
 * A page reload calls refresh() once on mount (AuthProvider) to get a new one
 * from the httpOnly refresh cookie, which IS what survives reloads.
 */
let accessToken: string | null = null;

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

async function rawRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    credentials: "include", // send/receive the httpOnly refresh cookie
  });

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, body.code ?? "ERROR", body.message ?? "Request failed");
  }
  return body as T;
}

/** Same as rawRequest, but on a 401 (expired access token) tries one silent refresh-and-retry before giving up. */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    return await rawRequest<T>(path, init);
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 401 && path !== "/api/v1/auth/refresh") {
      const refreshed = await tryRefresh();
      if (refreshed) return rawRequest<T>(path, init);
    }
    throw err;
  }
}

async function tryRefresh(): Promise<boolean> {
  try {
    const result = await rawRequest<{ user: CurrentUser; accessToken: string }>("/api/v1/auth/refresh", {
      method: "POST",
    });
    accessToken = result.accessToken;
    return true;
  } catch {
    accessToken = null;
    return false;
  }
}

export const api = {
  async register(input: { organizationName: string; fullName: string; email: string; password: string }) {
    const result = await rawRequest<{ user: CurrentUser; accessToken: string }>("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify(input),
    });
    accessToken = result.accessToken;
    return result.user;
  },

  async login(input: { email: string; password: string }) {
    const result = await rawRequest<{ user: CurrentUser; accessToken: string }>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
    });
    accessToken = result.accessToken;
    return result.user;
  },

  async logout() {
    await rawRequest("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined);
    accessToken = null;
  },

  /** Called once on app load — restores a session from the httpOnly refresh cookie, if any. */
  async restoreSession(): Promise<CurrentUser | null> {
    const ok = await tryRefresh();
    if (!ok) return null;
    return request<CurrentUser>("/api/v1/auth/me");
  },

  me: () => request<CurrentUser>("/api/v1/auth/me"),

  organization: {
    getCurrent: () => request<{ id: string; name: string; legalName: string | null; tin: string | null }>("/api/v1/organizations/current"),
    update: (input: { name?: string; legalName?: string; tin?: string }) =>
      request("/api/v1/organizations/current", { method: "PATCH", body: JSON.stringify(input) }),
  },

  members: {
    list: () => request<OrganizationMember[]>("/api/v1/members"),
    listInvitations: () => request<PendingInvitation[]>("/api/v1/members/invitations"),
    invite: (input: { email: string; role: string }) =>
      request<{ invitation: PendingInvitation; rawToken: string }>("/api/v1/members/invitations", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    revokeInvitation: (id: string) => request(`/api/v1/members/invitations/${id}`, { method: "DELETE" }),
    updateRole: (userId: string, role: string) =>
      request(`/api/v1/members/${userId}`, { method: "PATCH", body: JSON.stringify({ role }) }),
    remove: (userId: string) => request(`/api/v1/members/${userId}`, { method: "DELETE" }),
  },

  invitations: {
    getByToken: (token: string) =>
      rawRequest<{ email: string; role: string; organizationName: string }>(`/api/v1/invitations/${token}`),
    accept: (token: string, input: { fullName: string; password: string }) =>
      rawRequest(`/api/v1/invitations/${token}/accept`, { method: "POST", body: JSON.stringify(input) }),
  },
};
