import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import {
  assignPurchaseRequestSchema,
  createPurchaseRequestSchema,
  listPurchaseRequestsQuerySchema,
  purchaseRequestItemInputSchema,
  rejectPurchaseRequestSchema,
  updatePurchaseRequestItemSchema,
  updatePurchaseRequestSchema,
  type AssignPurchaseRequestInput,
  type CreatePurchaseRequestInput,
  type ListPurchaseRequestsQuery,
  type PurchaseRequestItemInput,
  type RejectPurchaseRequestInput,
  type UpdatePurchaseRequestInput,
  type UpdatePurchaseRequestItemInput,
} from "@top/validation";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AccessTokenClaims } from "../common/types/authenticated-request";
import { PurchaseRequestsService } from "./purchase-requests.service";

/**
 * M3.1 Phase D. RBAC matrix (Architecture Gate Revision 1 §J): create/edit
 * endpoints exclude APPROVER and SUPPLIER outright via `@Roles`; EMPLOYEE's
 * "own records only" restriction cannot be expressed by a static role
 * decorator, so it's enforced in the service (`visibilityWhere` /
 * `requireEditableDraftTx`). Read endpoints additionally allow APPROVER
 * (service-scoped to assigned-only, currently always empty — Phase D §31).
 * SUPPLIER has no route here at all — never granted, in any form.
 */
@Controller("api/v1/purchase-requests")
export class PurchaseRequestsController {
  constructor(private readonly purchaseRequests: PurchaseRequestsService) {}

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST", "EMPLOYEE")
  @Post()
  create(@CurrentUser() user: AccessTokenClaims, @Body(new ZodValidationPipe(createPurchaseRequestSchema)) body: CreatePurchaseRequestInput) {
    return this.purchaseRequests.create(user.organizationId, user.sub, body);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST", "EMPLOYEE", "APPROVER")
  @Get()
  list(@CurrentUser() user: AccessTokenClaims, @Query(new ZodValidationPipe(listPurchaseRequestsQuerySchema)) query: ListPurchaseRequestsQuery) {
    return this.purchaseRequests.list(user.organizationId, user.sub, user.role, query);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST", "EMPLOYEE", "APPROVER")
  @Get(":id")
  get(@CurrentUser() user: AccessTokenClaims, @Param("id") id: string) {
    return this.purchaseRequests.get(user.organizationId, user.sub, user.role, id);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST", "EMPLOYEE")
  @Patch(":id")
  update(
    @CurrentUser() user: AccessTokenClaims,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updatePurchaseRequestSchema)) body: UpdatePurchaseRequestInput
  ) {
    return this.purchaseRequests.update(user.organizationId, user.sub, user.role, id, body);
  }

  // ────────────────────────────────────────────────────────────
  // WORKFLOW (Phase E). SUPPLIER never appears in any @Roles list here — no
  // route in this controller is ever reachable by that role, in any form.
  // ────────────────────────────────────────────────────────────

  // @HttpCode(200) on every action below — NestJS defaults @Post() to 201,
  // but none of these "creates a resource" from the API's perspective (same
  // established precedent as product-convert/product-archive); each returns
  // the updated PurchaseRequestSummary.
  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST", "EMPLOYEE")
  @HttpCode(200)
  @Post(":id/submit")
  submit(@CurrentUser() user: AccessTokenClaims, @Param("id") id: string) {
    return this.purchaseRequests.submit(user.organizationId, user.sub, user.role, id);
  }

  // PROCUREMENT_SPECIALIST is deliberately excluded here (§10) — it may
  // submit a PR but never decide one.
  @Roles("ADMIN", "PROCUREMENT_MANAGER", "APPROVER")
  @HttpCode(200)
  @Post(":id/approve")
  approve(@CurrentUser() user: AccessTokenClaims, @Param("id") id: string) {
    return this.purchaseRequests.approve(user.organizationId, user.sub, user.role, id);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "APPROVER")
  @HttpCode(200)
  @Post(":id/reject")
  reject(
    @CurrentUser() user: AccessTokenClaims,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(rejectPurchaseRequestSchema)) body: RejectPurchaseRequestInput
  ) {
    return this.purchaseRequests.reject(user.organizationId, user.sub, user.role, id, body);
  }

  // EMPLOYEE is included here for the DRAFT case only — the APPROVED case
  // (EMPLOYEE denied) is a service-layer check (§19/§20), not expressible by
  // this static decorator alone.
  @Roles("ADMIN", "PROCUREMENT_MANAGER", "EMPLOYEE")
  @HttpCode(200)
  @Post(":id/cancel")
  cancel(@CurrentUser() user: AccessTokenClaims, @Param("id") id: string) {
    return this.purchaseRequests.cancel(user.organizationId, user.sub, user.role, id);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER")
  @Patch(":id/assign")
  assign(
    @CurrentUser() user: AccessTokenClaims,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(assignPurchaseRequestSchema)) body: AssignPurchaseRequestInput
  ) {
    return this.purchaseRequests.assign(user.organizationId, user.sub, user.role, id, body);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST", "EMPLOYEE")
  @Post(":id/items")
  addItem(
    @CurrentUser() user: AccessTokenClaims,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(purchaseRequestItemInputSchema)) body: PurchaseRequestItemInput
  ) {
    return this.purchaseRequests.addItem(user.organizationId, user.sub, user.role, id, body);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST", "EMPLOYEE")
  @Patch(":id/items/:itemId")
  updateItem(
    @CurrentUser() user: AccessTokenClaims,
    @Param("id") id: string,
    @Param("itemId") itemId: string,
    @Body(new ZodValidationPipe(updatePurchaseRequestItemSchema)) body: UpdatePurchaseRequestItemInput
  ) {
    return this.purchaseRequests.updateItem(user.organizationId, user.sub, user.role, id, itemId, body);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST", "EMPLOYEE")
  @Delete(":id/items/:itemId")
  removeItem(@CurrentUser() user: AccessTokenClaims, @Param("id") id: string, @Param("itemId") itemId: string) {
    return this.purchaseRequests.removeItem(user.organizationId, user.sub, user.role, id, itemId);
  }
}
