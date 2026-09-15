import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import {
  createLocationSchema,
  updateLocationSchema,
  type CreateLocationInput,
  type UpdateLocationInput,
} from "@top/validation";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AccessTokenClaims } from "../common/types/authenticated-request";
import { LocationsService } from "./locations.service";

// RBAC mirrors WarehousesController exactly. warehouseId always comes from
// the route, never the body — WarehousesService.requireWarehouse() is the
// composition check ("this Location's warehouse belongs to my organization").
@Controller("api/v1/warehouses/:warehouseId/locations")
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  list(@CurrentUser() user: AccessTokenClaims, @Param("warehouseId") warehouseId: string) {
    return this.locations.list(user.organizationId, warehouseId);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER")
  @Post()
  create(
    @CurrentUser() user: AccessTokenClaims,
    @Param("warehouseId") warehouseId: string,
    @Body(new ZodValidationPipe(createLocationSchema)) body: CreateLocationInput
  ) {
    return this.locations.create(user.organizationId, user.sub, warehouseId, body);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER")
  @Patch(":id")
  update(
    @CurrentUser() user: AccessTokenClaims,
    @Param("warehouseId") warehouseId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateLocationSchema)) body: UpdateLocationInput
  ) {
    return this.locations.update(user.organizationId, user.sub, warehouseId, id, body);
  }
}
