import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import {
  createStockMovementSchema,
  listStockMovementsQuerySchema,
  type CreateStockMovementInput,
  type ListStockMovementsQuery,
} from "@top/validation";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AccessTokenClaims } from "../common/types/authenticated-request";
import { StockMovementsService } from "./stock-movements.service";

/**
 * M2.5 (Architecture Gate Revision 2, Phase F). The single canonical
 * write command — POST is a domain command ("execute this movement"), not
 * generic CRUD create; no PATCH, no DELETE (StockMovement is immutable
 * history). `@Roles` here is the coarse, declarative pre-filter matching
 * every other Stock* write endpoint (rules out EMPLOYEE/SUPPLIER/APPROVER/
 * PROCUREMENT_SPECIALIST outright); the finer per-type rule (ADJUSTMENT is
 * ADMIN-only) is enforced inside StockMovementsService, since one route
 * serves six types with different requirements — a static route decorator
 * can't express that.
 *
 * GET list/detail (Phase G): no `@Roles` — same "any authenticated,
 * tenant-scoped member may read" posture as ProductsController.list/get
 * (RBAC matrix unchanged; read access was never role-restricted). Still no
 * PATCH/DELETE anywhere on this controller — StockMovement is immutable
 * business history.
 */
@Controller("api/v1/stock-movements")
export class StockMovementsController {
  constructor(private readonly movements: StockMovementsService) {}

  @Get()
  list(
    @CurrentUser() user: AccessTokenClaims,
    @Query(new ZodValidationPipe(listStockMovementsQuerySchema)) query: ListStockMovementsQuery
  ) {
    return this.movements.list(user.organizationId, query);
  }

  @Get(":id")
  get(@CurrentUser() user: AccessTokenClaims, @Param("id") id: string) {
    return this.movements.get(user.organizationId, id);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER")
  @Post()
  create(
    @CurrentUser() user: AccessTokenClaims,
    @Body(new ZodValidationPipe(createStockMovementSchema)) body: CreateStockMovementInput
  ) {
    return this.movements.create(user.organizationId, user.sub, user.role, body);
  }
}
