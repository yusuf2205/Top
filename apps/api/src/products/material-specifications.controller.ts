import { Body, Controller, Delete, Get, Param, Put } from "@nestjs/common";
import { setMaterialSpecificationSchema, type SetMaterialSpecificationInput } from "@top/validation";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AccessTokenClaims } from "../common/types/authenticated-request";
import { MaterialSpecificationsService } from "./material-specifications.service";

// RBAC (M2.3 §32): read — any authenticated member (matches Product read
// access). Write — ADMIN/PROCUREMENT_MANAGER/PROCUREMENT_SPECIALIST (matches
// Product create/edit). Delete — ADMIN/PROCUREMENT_MANAGER only (matches
// Product archive's stricter tier).
//
// PUT, not POST+PATCH: this resource is always exactly 0 or 1 per product
// (1:1), so there is no meaningful "create vs update" branch for the client
// to get wrong — PUT is a full replace (an omitted field is cleared, not
// left untouched).
@Controller("api/v1/products/:productId/specification")
export class MaterialSpecificationsController {
  constructor(private readonly specifications: MaterialSpecificationsService) {}

  @Get()
  get(@CurrentUser() user: AccessTokenClaims, @Param("productId") productId: string) {
    return this.specifications.get(user.organizationId, productId).then((specification) => ({ specification }));
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST")
  @Put()
  set(
    @CurrentUser() user: AccessTokenClaims,
    @Param("productId") productId: string,
    @Body(new ZodValidationPipe(setMaterialSpecificationSchema)) body: SetMaterialSpecificationInput
  ) {
    return this.specifications.set(user.organizationId, user.sub, productId, body);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER")
  @Delete()
  remove(@CurrentUser() user: AccessTokenClaims, @Param("productId") productId: string) {
    return this.specifications.remove(user.organizationId, user.sub, productId);
  }
}
