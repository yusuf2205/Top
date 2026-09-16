import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import {
  createCategorySchema,
  updateCategorySchema,
  type CreateCategoryInput,
  type UpdateCategoryInput,
} from "@top/validation";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AccessTokenClaims } from "../common/types/authenticated-request";
import { CategoriesService } from "./categories.service";

/** M3.2 (Architecture Gate Revision 1, R16/R20). GET: ADMIN/MANAGER/SPECIALIST. POST/PATCH: ADMIN/MANAGER only — a shared taxonomy affecting both PurchaseRequest and Supplier is more governance-worthy than routine data entry. */
@Controller("api/v1/categories")
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST")
  @Get()
  list(@CurrentUser() user: AccessTokenClaims, @Query("includeInactive") includeInactive?: string) {
    return this.categories.list(user.organizationId, includeInactive === "true");
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER")
  @Post()
  create(@CurrentUser() user: AccessTokenClaims, @Body(new ZodValidationPipe(createCategorySchema)) body: CreateCategoryInput) {
    return this.categories.create(user.organizationId, user.sub, body);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER")
  @Patch(":id")
  update(
    @CurrentUser() user: AccessTokenClaims,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateCategorySchema)) body: UpdateCategoryInput
  ) {
    return this.categories.update(user.organizationId, user.sub, id, body);
  }
}
