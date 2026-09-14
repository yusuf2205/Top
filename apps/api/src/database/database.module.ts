import { Global, Module } from "@nestjs/common";
import { createSystemPrismaClient, createTenantSafePrismaClient } from "@top/database";

export const TENANT_PRISMA = Symbol("TENANT_PRISMA");
export const SYSTEM_PRISMA = Symbol("SYSTEM_PRISMA");

/**
 * TENANT_PRISMA: use in every service that acts within an authenticated
 * request's tenant context (the AsyncLocalStorage context is established by
 * TenantContextInterceptor before any controller method runs). Throws if no
 * context is active — fail closed.
 *
 * SYSTEM_PRISMA: bypasses tenant isolation entirely. Only inject this where a
 * query genuinely has to run BEFORE a tenant is known — login (looking up a
 * user by email across all orgs), register (creating the first user of a new
 * org), refresh-token lookup by hash, and invitation-token lookup by hash.
 * See packages/database/src/client.ts for the full rationale. Do not inject
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
