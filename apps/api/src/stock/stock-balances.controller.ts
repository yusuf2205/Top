import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import {
  createStockBalanceSchema,
  listStockBalancesQuerySchema,
  updateStockBalanceSchema,
  type CreateStockBalanceInput,
  type ListStockBalancesQuery,
  type UpdateStockBalanceInput,
} from "@top/validation";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AccessTokenClaims } from "../common/types/authenticated-request";
import { StockBalancesService } from "./stock-balances.service";

// RBAC (M2.4-B approval §11): read — any authenticated member; write —
// ADMIN/PROCUREMENT_MANAGER only, same as Warehouse/Location. No DELETE —
// StockBalance is never hard-deleted (§12).
@Controller("api/v1/stock-balances")
export class StockBalancesController {
  constructor(private readonly balances: StockBalancesService) {}

  @Get()
  list(
    @CurrentUser() user: AccessTokenClaims,
    @Query(new ZodValidationPipe(listStockBalancesQuerySchema)) query: ListStockBalancesQuery
  ) {
    return this.balances.list(user.organizationId, query);
  }

  @Get(":id")
  get(@CurrentUser() user: AccessTokenClaims, @Param("id") id: string) {
    return this.balances.get(user.organizationId, id);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER")
  @Post()
  create(
    @CurrentUser() user: AccessTokenClaims,
    @Body(new ZodValidationPipe(createStockBalanceSchema)) body: CreateStockBalanceInput
  ) {
    return this.balances.create(user.organizationId, user.sub, body);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER")
  @Patch(":id")
  update(
    @CurrentUser() user: AccessTokenClaims,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateStockBalanceSchema)) body: UpdateStockBalanceInput
  ) {
    return this.balances.update(user.organizationId, user.sub, id, body);
  }
}
