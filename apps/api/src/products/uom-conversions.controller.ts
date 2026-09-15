import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import {
  createUomConversionSchema,
  updateUomConversionSchema,
  type CreateUomConversionInput,
  type UpdateUomConversionInput,
} from "@top/validation";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AccessTokenClaims } from "../common/types/authenticated-request";
import { UomConversionsService } from "./uom-conversions.service";

// RBAC (M2.2 §20): read — any authenticated member (matches Product read
// access). Mutations are stricter than plain Product CRUD — restricted to
// ADMIN/PROCUREMENT_MANAGER (no PROCUREMENT_SPECIALIST) — a wrong conversion
// factor silently propagates incorrect quantities across the whole future
// Stock module, a materially bigger blast radius than editing a product name.
@Controller("api/v1/products/:productId/conversions")
export class UomConversionsController {
  constructor(private readonly conversions: UomConversionsService) {}

  @Get()
  list(@CurrentUser() user: AccessTokenClaims, @Param("productId") productId: string) {
    return this.conversions.list(user.organizationId, productId);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER")
  @Post()
  create(
    @CurrentUser() user: AccessTokenClaims,
    @Param("productId") productId: string,
    @Body(new ZodValidationPipe(createUomConversionSchema)) body: CreateUomConversionInput
  ) {
    return this.conversions.create(user.organizationId, user.sub, productId, body);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER")
  @Patch(":conversionId")
  update(
    @CurrentUser() user: AccessTokenClaims,
    @Param("productId") productId: string,
    @Param("conversionId") conversionId: string,
    @Body(new ZodValidationPipe(updateUomConversionSchema)) body: UpdateUomConversionInput
  ) {
    return this.conversions.update(user.organizationId, user.sub, productId, conversionId, body);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER")
  @Delete(":conversionId")
  remove(
    @CurrentUser() user: AccessTokenClaims,
    @Param("productId") productId: string,
    @Param("conversionId") conversionId: string
  ) {
    return this.conversions.remove(user.organizationId, user.sub, productId, conversionId);
  }
}
