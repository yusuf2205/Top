import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { TokenService } from "./token.service";

@Global()
@Module({
  imports: [JwtModule.register({})], // secret passed per-call in TokenService (access vs refresh use different secrets elsewhere)
  providers: [TokenService],
  exports: [TokenService],
})
export class TokenModule {}
