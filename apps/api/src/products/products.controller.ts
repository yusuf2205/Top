import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import {
  createProductSchema,
  listProductsQuerySchema,
  updateProductSchema,
  type CreateProductInput,
  type ListProductsQuery,
  type UpdateProductInput,
} from "@top/validation";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AccessTokenClaims } from "../common/types/authenticated-request";
import { ProductsService } from "./products.service";

// RBAC Matrix (M2-PRODUCT-STOCK-ARCHITECTURE.md §19): read — any authenticated
// member (EMPLOYEE/APPROVER included, read-only); create/edit —
// ADMIN/PROCUREMENT_MANAGER/PROCUREMENT_SPECIALIST; archive — ADMIN/PROCUREMENT_MANAGER only.
@Controller("api/v1/products")
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(
    @CurrentUser() user: AccessTokenClaims,
    @Query(new ZodValidationPipe(listProductsQuerySchema)) query: ListProductsQuery
  ) {
    return this.products.list(user.organizationId, query);
  }

  @Get(":id")
  get(@CurrentUser() user: AccessTokenClaims, @Param("id") id: string) {
    return this.products.get(user.organizationId, id);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST")
  @Post()
  create(
    @CurrentUser() user: AccessTokenClaims,
    @Body(new ZodValidationPipe(createProductSchema)) body: CreateProductInput
  ) {
    return this.products.create(user.organizationId, user.sub, body);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST")
  @Patch(":id")
  update(
    @CurrentUser() user: AccessTokenClaims,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateProductSchema)) body: UpdateProductInput
  ) {
    return this.products.update(user.organizationId, user.sub, id, body);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER")
  @Post(":id/archive")
  @HttpCode(200)
  archive(@CurrentUser() user: AccessTokenClaims, @Param("id") id: string) {
    return this.products.archive(user.organizationId, user.sub, id);
  }
}
