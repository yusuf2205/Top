import { Body, Controller, HttpCode, Param, Post } from "@nestjs/common";
import { convertQuantitySchema, type ConvertQuantityInput } from "@top/validation";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AccessTokenClaims } from "../common/types/authenticated-request";
import { UomConversionsService } from "./uom-conversions.service";

// A read-only computation, not a mutation — open to any authenticated member,
// same as Product GET. No @Roles() restriction needed.
@Controller("api/v1/products/:productId/convert")
export class ProductConvertController {
  constructor(private readonly conversions: UomConversionsService) {}

  @Post()
  @HttpCode(200) // NestJS defaults @Post() to 201; this isn't creating a resource (same lesson as M2.1's archive endpoint)
  convert(
    @CurrentUser() user: AccessTokenClaims,
    @Param("productId") productId: string,
    @Body(new ZodValidationPipe(convertQuantitySchema)) body: ConvertQuantityInput
  ) {
    return this.conversions.convert(user.organizationId, productId, body);
  }
}
