import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import {
  addRfqItemSchema,
  addRfqSupplierSchema,
  cancelRfqSchema,
  closeRfqSchema,
  createRfqSchema,
  listRfqsQuerySchema,
  updateRfqSchema,
  type AddRfqItemInput,
  type AddRfqSupplierInput,
  type CancelRfqInput,
  type CloseRfqInput,
  type CreateRfqInput,
  type ListRfqsQuery,
  type UpdateRfqInput,
} from "@top/validation";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AccessTokenClaims } from "../common/types/authenticated-request";
import { RfqsService } from "./rfqs.service";
import { RfqPortalAccessService } from "./rfq-portal-access.service";

/**
 * M3.3 Phase C (Architecture Revision 1, locked). Flat RBAC — every route
 * here allows exactly ADMIN/PROCUREMENT_MANAGER/PROCUREMENT_SPECIALIST, no
 * ownership-based visibility (unlike PurchaseRequestsController's EMPLOYEE/
 * APPROVER branches) — RFQ has no "own records" concept at all (§5/§65).
 * EMPLOYEE/APPROVER/SUPPLIER never appear in any @Roles list on this
 * controller — no route is reachable by them, in any form.
 *
 * `send` has no request body — no schema/DTO invented for it, matching the
 * established convention (submit/approve/cancel on PurchaseRequestsController
 * take no schema either — see rfqs.ts's own file-level DEVIATION note).
 */
@Controller("api/v1/rfqs")
export class RfqsController {
  constructor(
    private readonly rfqs: RfqsService,
    private readonly portalAccess: RfqPortalAccessService
  ) {}

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST")
  @Post()
  create(@CurrentUser() user: AccessTokenClaims, @Body(new ZodValidationPipe(createRfqSchema)) body: CreateRfqInput) {
    return this.rfqs.create(user.organizationId, user.sub, body);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST")
  @Get()
  list(@CurrentUser() user: AccessTokenClaims, @Query(new ZodValidationPipe(listRfqsQuerySchema)) query: ListRfqsQuery) {
    return this.rfqs.list(user.organizationId, query);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST")
  @Get(":id")
  get(@CurrentUser() user: AccessTokenClaims, @Param("id") id: string) {
    return this.rfqs.get(user.organizationId, id);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST")
  @Patch(":id")
  update(@CurrentUser() user: AccessTokenClaims, @Param("id") id: string, @Body(new ZodValidationPipe(updateRfqSchema)) body: UpdateRfqInput) {
    return this.rfqs.update(user.organizationId, user.sub, id, body);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST")
  @Post(":id/items")
  addItem(@CurrentUser() user: AccessTokenClaims, @Param("id") id: string, @Body(new ZodValidationPipe(addRfqItemSchema)) body: AddRfqItemInput) {
    return this.rfqs.addItem(user.organizationId, user.sub, id, body);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST")
  @Delete(":id/items/:rfqItemId")
  removeItem(@CurrentUser() user: AccessTokenClaims, @Param("id") id: string, @Param("rfqItemId") rfqItemId: string) {
    return this.rfqs.removeItem(user.organizationId, user.sub, id, rfqItemId);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST")
  @Post(":id/suppliers")
  addSupplier(@CurrentUser() user: AccessTokenClaims, @Param("id") id: string, @Body(new ZodValidationPipe(addRfqSupplierSchema)) body: AddRfqSupplierInput) {
    return this.rfqs.addSupplier(user.organizationId, user.sub, id, body);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST")
  @Delete(":id/suppliers/:rfqSupplierId")
  removeSupplier(@CurrentUser() user: AccessTokenClaims, @Param("id") id: string, @Param("rfqSupplierId") rfqSupplierId: string) {
    return this.rfqs.removeSupplier(user.organizationId, user.sub, id, rfqSupplierId);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST")
  @HttpCode(200)
  @Post(":id/send")
  send(@CurrentUser() user: AccessTokenClaims, @Param("id") id: string) {
    return this.rfqs.send(user.organizationId, user.sub, id);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST")
  @HttpCode(200)
  @Post(":id/close")
  close(@CurrentUser() user: AccessTokenClaims, @Param("id") id: string, @Body(new ZodValidationPipe(closeRfqSchema)) body: CloseRfqInput) {
    return this.rfqs.close(user.organizationId, user.sub, id, body);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST")
  @HttpCode(200)
  @Post(":id/cancel")
  cancel(@CurrentUser() user: AccessTokenClaims, @Param("id") id: string, @Body(new ZodValidationPipe(cancelRfqSchema)) body: CancelRfqInput) {
    return this.rfqs.cancel(user.organizationId, user.sub, id, body);
  }

  // ────────────────────────────────────────────────────────────
  // M3.4 Supplier Portal Phase C — internal portal-access management
  // (Architecture §3-4). Same flat RBAC as every other route on this
  // controller — no ownership rule, cross-org/cross-parent is 404.
  // ────────────────────────────────────────────────────────────

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST")
  @HttpCode(200)
  @Post(":id/suppliers/:rfqSupplierId/invite")
  invite(@CurrentUser() user: AccessTokenClaims, @Param("id") id: string, @Param("rfqSupplierId") rfqSupplierId: string) {
    return this.portalAccess.invite(user.organizationId, user.sub, id, rfqSupplierId);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST")
  @HttpCode(200)
  @Post(":id/suppliers/:rfqSupplierId/reissue")
  reissue(@CurrentUser() user: AccessTokenClaims, @Param("id") id: string, @Param("rfqSupplierId") rfqSupplierId: string) {
    return this.portalAccess.reissue(user.organizationId, user.sub, id, rfqSupplierId);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST")
  @HttpCode(200)
  @Post(":id/suppliers/:rfqSupplierId/revoke")
  revoke(@CurrentUser() user: AccessTokenClaims, @Param("id") id: string, @Param("rfqSupplierId") rfqSupplierId: string) {
    return this.portalAccess.revoke(user.organizationId, user.sub, id, rfqSupplierId);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST")
  @Get(":id/suppliers/:rfqSupplierId/quote")
  getQuote(@CurrentUser() user: AccessTokenClaims, @Param("id") id: string, @Param("rfqSupplierId") rfqSupplierId: string) {
    return this.portalAccess.getQuote(user.organizationId, id, rfqSupplierId);
  }
}
