import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import {
  createProductCategorySchema,
  updateProductCategorySchema,
  type CreateProductCategoryInput,
  type UpdateProductCategoryInput,
} from "@top/validation";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AccessTokenClaims } from "../common/types/authenticated-request";
import { ProductCategoriesService } from "./product-categories.service";

// RBAC Matrix (M2-PRODUCT-STOCK-ARCHITECTURE.md §19): read — any authenticated
// member; create/edit — ADMIN/PROCUREMENT_MANAGER/PROCUREMENT_SPECIALIST.
@Controller("api/v1/product-categories")
export class ProductCategoriesController {
  constructor(private readonly categories: ProductCategoriesService) {}

  @Get()
  list(@CurrentUser() user: AccessTokenClaims) {
    return this.categories.list(user.organizationId);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST")
  @Post()
  create(
    @CurrentUser() user: AccessTokenClaims,
    @Body(new ZodValidationPipe(createProductCategorySchema)) body: CreateProductCategoryInput
  ) {
    return this.categories.create(user.organizationId, user.sub, body);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST")
  @Patch(":id")
  update(
    @CurrentUser() user: AccessTokenClaims,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateProductCategorySchema)) body: UpdateProductCategoryInput
  ) {
    return this.categories.update(user.organizationId, user.sub, id, body);
  }
}
