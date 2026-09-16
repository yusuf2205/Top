import { Global, Module } from "@nestjs/common";
import { EntitySequenceService } from "./entity-sequence.service";

@Global()
@Module({
  providers: [EntitySequenceService],
  exports: [EntitySequenceService],
})
export class EntitySequenceModule {}
