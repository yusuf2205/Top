import type {
  CategorySummary,
  CurrentUser,
  OrganizationMember,
  PendingInvitation,
  ProductListResult,
  PurchaseRequestListResult,
  PurchaseRequestSummary,
  SupplierCapabilityView,
  SupplierContactView,
  SupplierDetail,
  SupplierListResult,
} from "@top/types";
import type {
  AddSupplierCapabilityInput,
  AssignPurchaseRequestInput,
  CreateCategoryInput,
  CreatePurchaseRequestInput,
  CreateSupplierContactInput,
  CreateSupplierInput,
  PurchaseRequestItemInput,
  RejectPurchaseRequestInput,
  UpdateCategoryInput,
  UpdatePurchaseRequestInput,
  UpdatePurchaseRequestItemInput,
  UpdateSupplierContactInput,
  UpdateSupplierInput,
  UpdateSupplierRatingInput,
  UpdateSupplierStatusInput,
} from "@top/validation";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * Access token lives ONLY in memory (module-level variable) — never
 * localStorage/sessionStorage, so it isn't readable by an XSS payload that
 * persists across reloads, and it disappears automatically on tab close.
 * A page reload calls refresh() once on mount (AuthProvider) to get a new one
 * from the httpOnly refresh cookie, which IS what survives reloads.
 */
let accessToken: string | null = null;

/** Read-only access for the realtime client (socket handshake `auth.token`) — never exposed for storage/persistence, just the current in-memory value at connect/reconnect time. */
export function getAccessToken(): string | null {
  return accessToken;
}

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

/** Only defined values are sent — never an explicit "undefined"/"null" query param string. */
function toQueryString(params: object): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params as Record<string, string | number | undefined>)) {
    if (value !== undefined && value !== "") usp.set(key, String(value));
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

export interface PurchaseRequestListQuery {
  status?: string;
  requesterUserId?: string;
  assignedBuyerUserId?: string;
  priority?: string;
  requestNumber?: string;
  requiredDate?: string;
  createdAtFrom?: string;
  createdAtTo?: string;
  page?: number;
  pageSize?: number;
}

export interface ProductListQuery {
  search?: string;
  categoryId?: string;
  productType?: string;
  active?: "true" | "false";
  page?: number;
  pageSize?: number;
}

export interface SupplierListQuery {
  search?: string;
  status?: string;
  categoryId?: string;
  countryCode?: string;
  page?: number;
  pageSize?: number;
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

  products: {
    list: (query: ProductListQuery = {}) =>
      request<ProductListResult>(`/api/v1/products${toQueryString(query)}`),
  },

  purchaseRequests: {
    list: (query: PurchaseRequestListQuery = {}) =>
      request<PurchaseRequestListResult>(`/api/v1/purchase-requests${toQueryString(query)}`),

    get: (id: string) => request<PurchaseRequestSummary>(`/api/v1/purchase-requests/${id}`),

    create: (input: CreatePurchaseRequestInput) =>
      request<PurchaseRequestSummary>("/api/v1/purchase-requests", { method: "POST", body: JSON.stringify(input) }),

    update: (id: string, input: UpdatePurchaseRequestInput) =>
      request<PurchaseRequestSummary>(`/api/v1/purchase-requests/${id}`, { method: "PATCH", body: JSON.stringify(input) }),

    addItem: (id: string, input: PurchaseRequestItemInput) =>
      request<PurchaseRequestSummary["items"][number]>(`/api/v1/purchase-requests/${id}/items`, {
        method: "POST",
        body: JSON.stringify(input),
      }),

    updateItem: (id: string, itemId: string, input: UpdatePurchaseRequestItemInput) =>
      request<PurchaseRequestSummary["items"][number]>(`/api/v1/purchase-requests/${id}/items/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),

    removeItem: (id: string, itemId: string) =>
      request<void>(`/api/v1/purchase-requests/${id}/items/${itemId}`, { method: "DELETE" }),

    submit: (id: string) => request<PurchaseRequestSummary>(`/api/v1/purchase-requests/${id}/submit`, { method: "POST" }),

    approve: (id: string) => request<PurchaseRequestSummary>(`/api/v1/purchase-requests/${id}/approve`, { method: "POST" }),

    reject: (id: string, input: RejectPurchaseRequestInput) =>
      request<PurchaseRequestSummary>(`/api/v1/purchase-requests/${id}/reject`, { method: "POST", body: JSON.stringify(input) }),

    cancel: (id: string) => request<PurchaseRequestSummary>(`/api/v1/purchase-requests/${id}/cancel`, { method: "POST" }),

    assignBuyer: (id: string, input: AssignPurchaseRequestInput) =>
      request<PurchaseRequestSummary>(`/api/v1/purchase-requests/${id}/assign`, { method: "PATCH", body: JSON.stringify(input) }),
  },

  suppliers: {
    list: (query: SupplierListQuery = {}) => request<SupplierListResult>(`/api/v1/suppliers${toQueryString(query)}`),

    get: (id: string) => request<SupplierDetail>(`/api/v1/suppliers/${id}`),

    create: (input: CreateSupplierInput) => request<SupplierDetail>("/api/v1/suppliers", { method: "POST", body: JSON.stringify(input) }),

    update: (id: string, input: UpdateSupplierInput) =>
      request<SupplierDetail>(`/api/v1/suppliers/${id}`, { method: "PATCH", body: JSON.stringify(input) }),

    updateStatus: (id: string, input: UpdateSupplierStatusInput) =>
      request<SupplierDetail>(`/api/v1/suppliers/${id}/status`, { method: "PATCH", body: JSON.stringify(input) }),

    updateRating: (id: string, input: UpdateSupplierRatingInput) =>
      request<SupplierDetail>(`/api/v1/suppliers/${id}/rating`, { method: "PATCH", body: JSON.stringify(input) }),

    addContact: (id: string, input: CreateSupplierContactInput) =>
      request<SupplierContactView>(`/api/v1/suppliers/${id}/contacts`, { method: "POST", body: JSON.stringify(input) }),

    updateContact: (id: string, contactId: string, input: UpdateSupplierContactInput) =>
      request<SupplierContactView>(`/api/v1/suppliers/${id}/contacts/${contactId}`, { method: "PATCH", body: JSON.stringify(input) }),

    archiveContact: (id: string, contactId: string) =>
      request<SupplierContactView>(`/api/v1/suppliers/${id}/contacts/${contactId}/archive`, { method: "POST" }),

    addCapability: (id: string, input: AddSupplierCapabilityInput) =>
      request<SupplierCapabilityView>(`/api/v1/suppliers/${id}/capabilities`, { method: "POST", body: JSON.stringify(input) }),

    removeCapability: (id: string, categoryId: string) =>
      request<void>(`/api/v1/suppliers/${id}/capabilities/${categoryId}`, { method: "DELETE" }),
  },

  categories: {
    list: (includeInactive = false) =>
      request<CategorySummary[]>(`/api/v1/categories${includeInactive ? "?includeInactive=true" : ""}`),

    create: (input: CreateCategoryInput) => request<CategorySummary>("/api/v1/categories", { method: "POST", body: JSON.stringify(input) }),

    update: (id: string, input: UpdateCategoryInput) =>
      request<CategorySummary>(`/api/v1/categories/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  },
};
