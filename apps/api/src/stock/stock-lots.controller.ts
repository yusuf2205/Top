import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import {
  createStockLotSchema,
  listStockLotsQuerySchema,
  updateStockLotSchema,
  type CreateStockLotInput,
  type ListStockLotsQuery,
  type UpdateStockLotInput,
} from "@top/validation";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AccessTokenClaims } from "../common/types/authenticated-request";
import { StockLotsService } from "./stock-lots.service";

// RBAC (M2.4-C approval §14): read — any authenticated member; write —
// ADMIN/PROCUREMENT_MANAGER only, same as StockBalance. No DELETE — a lot is
// never hard-deleted. Creating/updating a lot never touches StockBalance
// (§16 of the approval) — see StockLotsService's doc comment.
@Controller("api/v1/stock-lots")
export class StockLotsController {
  constructor(private readonly stockLots: StockLotsService) {}

  @Get()
  list(
    @CurrentUser() user: AccessTokenClaims,
    @Query(new ZodValidationPipe(listStockLotsQuerySchema)) query: ListStockLotsQuery
  ) {
    return this.stockLots.list(user.organizationId, query);
  }

  @Get(":id")
  get(@CurrentUser() user: AccessTokenClaims, @Param("id") id: string) {
    return this.stockLots.get(user.organizationId, id);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER")
  @Post()
  create(
    @CurrentUser() user: AccessTokenClaims,
    @Body(new ZodValidationPipe(createStockLotSchema)) body: CreateStockLotInput
  ) {
    return this.stockLots.create(user.organizationId, user.sub, body);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER")
  @Patch(":id")
  update(
    @CurrentUser() user: AccessTokenClaims,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateStockLotSchema)) body: UpdateStockLotInput
  ) {
    return this.stockLots.update(user.organizationId, user.sub, id, body);
  }
}
