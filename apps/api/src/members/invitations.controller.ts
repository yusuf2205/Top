import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";
import { acceptInvitationSchema, type AcceptInvitationInput } from "@top/validation";
import { Public } from "../common/decorators/public.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { MembersService } from "./members.service";

/** Unauthenticated token-based flow — separate controller from MembersController so @Public() reads clearly at the class level. */
@Public()
@Controller("api/v1/invitations")
export class InvitationsController {
  constructor(private readonly members: MembersService) {}

  @Get(":token")
  getByToken(@Param("token") token: string) {
    return this.members.getInvitationByToken(token);
  }

  @HttpCode(HttpStatus.OK)
  @Post(":token/accept")
  async accept(
    @Param("token") token: string,
    @Body(new ZodValidationPipe(acceptInvitationSchema.omit({ token: true }))) body: Omit<AcceptInvitationInput, "token">
  ) {
    await this.members.acceptInvitation(token, { ...body, token });
    return { success: true };
  }
}
