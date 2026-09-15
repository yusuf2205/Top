import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import {
  createWarehouseSchema,
  updateWarehouseSchema,
  type CreateWarehouseInput,
  type UpdateWarehouseInput,
} from "@top/validation";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AccessTokenClaims } from "../common/types/authenticated-request";
import { WarehousesService } from "./warehouses.service";

// RBAC (M2.4-A approval): read — any authenticated member; write —
// ADMIN/PROCUREMENT_MANAGER only (no PROCUREMENT_SPECIALIST — a misconfigured
// warehouse silently corrupts every future stock operation against it, same
// reasoning as M2.2's UomConversion RBAC). No hard delete — PATCH active:false only.
@Controller("api/v1/warehouses")
export class WarehousesController {
  constructor(private readonly warehouses: WarehousesService) {}

  @Get()
  list(@CurrentUser() user: AccessTokenClaims) {
    return this.warehouses.list(user.organizationId);
  }

  @Get(":id")
  get(@CurrentUser() user: AccessTokenClaims, @Param("id") id: string) {
    return this.warehouses.get(user.organizationId, id);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER")
  @Post()
  create(
    @CurrentUser() user: AccessTokenClaims,
    @Body(new ZodValidationPipe(createWarehouseSchema)) body: CreateWarehouseInput
  ) {
    return this.warehouses.create(user.organizationId, user.sub, body);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER")
  @Patch(":id")
  update(
    @CurrentUser() user: AccessTokenClaims,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateWarehouseSchema)) body: UpdateWarehouseInput
  ) {
    return this.warehouses.update(user.organizationId, user.sub, id, body);
  }
}
