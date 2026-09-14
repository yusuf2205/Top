import { Module } from "@nestjs/common";
import { MembersController } from "./members.controller";
import { InvitationsController } from "./invitations.controller";
import { MembersService } from "./members.service";
import { PasswordService } from "../common/auth/password.service";

@Module({
  controllers: [MembersController, InvitationsController],
  providers: [MembersService, PasswordService],
})
export class MembersModule {}
