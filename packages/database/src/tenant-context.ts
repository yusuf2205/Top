import { AsyncLocalStorage } from "node:async_hooks";

export interface TenantContext {
  organizationId: string;
}

const storage = new AsyncLocalStorage<TenantContext>();

/**
 * Every request that touches tenant-owned data must be wrapped in this
 * (NestJS TenantGuard/interceptor does this once per request, from the
 * organizationId claim on the JWT — never from client-supplied input).
 */
export function runWithTenantContext<T>(context: TenantContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** Throws if called outside a tenant context — fail closed, not open. */
export function getTenantContext(): TenantContext {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new Error(
      "No tenant context set. Every tenant-scoped database call must run inside " +
        "runWithTenantContext() (set once per HTTP request / job by the caller)."
    );
  }
  return ctx;
}

export function getTenantContextOrNull(): TenantContext | null {
  return storage.getStore() ?? null;
}
