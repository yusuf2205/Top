import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import {
  createStockPieceSchema,
  listStockPiecesQuerySchema,
  type CreateStockPieceInput,
  type ListStockPiecesQuery,
} from "@top/validation";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AccessTokenClaims } from "../common/types/authenticated-request";
import { StockPiecesService } from "./stock-pieces.service";

// M2.4-D (final, approved with changes): CRUD/read only — GET list, GET :id,
// POST. Deliberately no PATCH (a piece's quantity/status are part of its
// physical identity/history, not administrative fields — changes belong to
// a future explicit domain operation) and no DELETE. RBAC matches every
// other Stock* controller: read — any authenticated member; write —
// ADMIN/PROCUREMENT_MANAGER only.
@Controller("api/v1/stock-pieces")
export class StockPiecesController {
  constructor(private readonly pieces: StockPiecesService) {}

  @Get()
  list(
    @CurrentUser() user: AccessTokenClaims,
    @Query(new ZodValidationPipe(listStockPiecesQuerySchema)) query: ListStockPiecesQuery
  ) {
    return this.pieces.list(user.organizationId, query);
  }

  @Get(":id")
  get(@CurrentUser() user: AccessTokenClaims, @Param("id") id: string) {
    return this.pieces.get(user.organizationId, id);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER")
  @Post()
  create(
    @CurrentUser() user: AccessTokenClaims,
    @Body(new ZodValidationPipe(createStockPieceSchema)) body: CreateStockPieceInput
  ) {
    return this.pieces.create(user.organizationId, user.sub, body);
  }
}
