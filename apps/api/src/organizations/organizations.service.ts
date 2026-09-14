import { Inject, Injectable } from "@nestjs/common";
import type { createTenantSafePrismaClient } from "@top/database";
import type { UpdateOrganizationInput } from "@top/validation";
import { TENANT_PRISMA } from "../database/database.module";
import { AuditService } from "../common/audit/audit.service";

type TenantDb = ReturnType<typeof createTenantSafePrismaClient>;

@Injectable()
export class OrganizationsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantDb,
    private readonly audit: AuditService
  ) {}

  async getCurrent(organizationId: string) {
    // organizationId is redundant in the `where` here (the tenant-safe client
    // injects it automatically) but findUniqueOrThrow needs a unique field —
    // `id` doubles as that and is still checked against the injected value.
    return this.db.organization.findUniqueOrThrow({ where: { id: organizationId } });
  }

  async update(organizationId: string, userId: string, input: UpdateOrganizationInput) {
    const before = await this.db.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const updated = await this.db.organization.update({ where: { id: organizationId }, data: input });

    await this.audit.log({
      organizationId,
      userId,
      action: "ORGANIZATION_UPDATED",
      entityType: "Organization",
      entityId: organizationId,
      oldValue: before as unknown as Record<string, unknown>,
      newValue: updated as unknown as Record<string, unknown>,
    });

    return updated;
  }
}
