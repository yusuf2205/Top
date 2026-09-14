import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { inviteMemberSchema, updateMemberRoleSchema, type InviteMemberInput, type UpdateMemberRoleInput } from "@top/validation";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AccessTokenClaims } from "../common/types/authenticated-request";
import { MembersService } from "./members.service";

// RBAC Matrix: "Управление Organization/Users/..." is Admin-only for every
// mutating action here; any authenticated member may list their colleagues.
@Controller("api/v1/members")
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  list(@CurrentUser() user: AccessTokenClaims) {
    return this.members.list(user.organizationId);
  }

  @Roles("ADMIN")
  @Get("invitations")
  listInvitations(@CurrentUser() user: AccessTokenClaims) {
    return this.members.listPendingInvitations(user.organizationId);
  }

  @Roles("ADMIN")
  @Post("invitations")
  invite(
    @CurrentUser() user: AccessTokenClaims,
    @Body(new ZodValidationPipe(inviteMemberSchema)) body: InviteMemberInput
  ) {
    return this.members.invite(user.organizationId, user.sub, body);
  }

  @Roles("ADMIN")
  @Delete("invitations/:id")
  revokeInvitation(@CurrentUser() user: AccessTokenClaims, @Param("id") id: string) {
    return this.members.revokeInvitation(user.organizationId, id, user.sub);
  }

  @Roles("ADMIN")
  @Patch(":userId")
  updateRole(
    @CurrentUser() user: AccessTokenClaims,
    @Param("userId") userId: string,
    @Body(new ZodValidationPipe(updateMemberRoleSchema)) body: UpdateMemberRoleInput
  ) {
    return this.members.updateRole(user.organizationId, userId, body.role, user.sub);
  }

  @Roles("ADMIN")
  @Delete(":userId")
  remove(@CurrentUser() user: AccessTokenClaims, @Param("userId") userId: string) {
    return this.members.remove(user.organizationId, userId, user.sub);
  }
}
