import { Global, Module } from "@nestjs/common";
import { createSystemPrismaClient, createTenantSafePrismaClient } from "@top/database";

export const TENANT_PRISMA = Symbol("TENANT_PRISMA");
export const SYSTEM_PRISMA = Symbol("SYSTEM_PRISMA");

/**
 * M2.5 (Phase F). The type of the `tx` argument an interactive
 * `TENANT_PRISMA.$transaction(async (tx) => {...})` callback actually
 * receives — derived directly from the extended (tenant-safe) client's own
 * `$transaction` signature, NOT the plain `Prisma.TransactionClient` type.
 * Those two are NOT freely interchangeable: `Prisma.TransactionClient`
 * describes a non-extended client's transaction object, and passing the
 * real extended-client `tx` to a parameter typed that way fails to
 * typecheck (confirmed empirically in Phase F — a generic/`InternalArgs`
 * mismatch, not a real behavioral difference). Every helper method across
 * this codebase that accepts a transaction client from
 * TENANT_PRISMA.$transaction(...) should use THIS type, not
 * `Prisma.TransactionClient`.
 */
export type TenantTransactionClient = Parameters<Parameters<ReturnType<typeof createTenantSafePrismaClient>["$transaction"]>[0]>[0];

/**
 * TENANT_PRISMA: use in every service that acts within an authenticated
 * request's tenant context (the AsyncLocalStorage context is established by
 * TenantContextInterceptor before any controller method runs). Throws if no
 * context is active — fail closed.
 *
 * SYSTEM_PRISMA: bypasses tenant isolation entirely. Only inject this where a
 * query genuinely has to run BEFORE a tenant is known — login (looking up a
 * user by email across all orgs), register (creating the first user of a new
 * org), refresh-token lookup by hash, invitation-token lookup by hash, and
 * (Realtime Foundation) socket handshake authentication — a live `User.active`
 * check at connection time, the WS analogue of login/refresh since a socket
 * is long-lived and JwtAuthGuard's plain claims-trust model doesn't apply the
 * same way (see SocketAuthService's own doc comment). See
 * packages/database/src/client.ts for the full rationale. Do not inject
 * SYSTEM_PRISMA into any other service.
 */
@Global()
@Module({
  providers: [
    { provide: TENANT_PRISMA, useFactory: () => createTenantSafePrismaClient() },
    { provide: SYSTEM_PRISMA, useFactory: () => createSystemPrismaClient() },
  ],
  exports: [TENANT_PRISMA, SYSTEM_PRISMA],
})
export class DatabaseModule {}
