import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import {
  createStockLotPlacementSchema,
  listStockLotPlacementsQuerySchema,
  updateStockLotPlacementSchema,
  type CreateStockLotPlacementInput,
  type ListStockLotPlacementsQuery,
  type UpdateStockLotPlacementInput,
} from "@top/validation";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AccessTokenClaims } from "../common/types/authenticated-request";
import { StockLotPlacementsService } from "./stock-lot-placements.service";

// RBAC mirrors StockLotsController. stockLotId always comes from the route —
// StockLotsService.requireLot() is the composition check ("this placement's
// lot belongs to my organization"). CRITICAL: none of these endpoints touch
// StockBalance (§16/§21 of the M2.4-C approval) — see the service's doc comment.
@Controller("api/v1/stock-lots/:stockLotId/placements")
export class StockLotPlacementsController {
  constructor(private readonly placements: StockLotPlacementsService) {}

  @Get()
  list(
    @CurrentUser() user: AccessTokenClaims,
    @Param("stockLotId") stockLotId: string,
    @Query(new ZodValidationPipe(listStockLotPlacementsQuerySchema)) query: ListStockLotPlacementsQuery
  ) {
    return this.placements.list(user.organizationId, stockLotId, query);
  }

  @Get(":id")
  get(@CurrentUser() user: AccessTokenClaims, @Param("stockLotId") stockLotId: string, @Param("id") id: string) {
    return this.placements.get(user.organizationId, stockLotId, id);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER")
  @Post()
  create(
    @CurrentUser() user: AccessTokenClaims,
    @Param("stockLotId") stockLotId: string,
    @Body(new ZodValidationPipe(createStockLotPlacementSchema)) body: CreateStockLotPlacementInput
  ) {
    return this.placements.create(user.organizationId, user.sub, stockLotId, body);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER")
  @Patch(":id")
  update(
    @CurrentUser() user: AccessTokenClaims,
    @Param("stockLotId") stockLotId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateStockLotPlacementSchema)) body: UpdateStockLotPlacementInput
  ) {
    return this.placements.update(user.organizationId, user.sub, stockLotId, id, body);
  }
}
