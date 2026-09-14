import { Body, Controller, Get, Patch } from "@nestjs/common";
import type { UpdateOrganizationInput } from "@top/validation";
import { updateOrganizationSchema } from "@top/validation";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AccessTokenClaims } from "../common/types/authenticated-request";
import { OrganizationsService } from "./organizations.service";

@Controller("api/v1/organizations")
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get("current")
  getCurrent(@CurrentUser() user: AccessTokenClaims) {
    return this.organizations.getCurrent(user.organizationId);
  }

  // RBAC Matrix: "Управление Organization/Users/..." — Admin only.
  @Roles("ADMIN")
  @Patch("current")
  update(
    @CurrentUser() user: AccessTokenClaims,
    @Body(new ZodValidationPipe(updateOrganizationSchema)) body: UpdateOrganizationInput
  ) {
    return this.organizations.update(user.organizationId, user.sub, body);
  }
}
