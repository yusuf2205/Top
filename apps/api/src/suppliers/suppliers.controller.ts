import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import {
  addSupplierCapabilitySchema,
  createSupplierContactSchema,
  createSupplierSchema,
  listSuppliersQuerySchema,
  updateSupplierContactSchema,
  updateSupplierRatingSchema,
  updateSupplierSchema,
  updateSupplierStatusSchema,
  type AddSupplierCapabilityInput,
  type CreateSupplierContactInput,
  type CreateSupplierInput,
  type ListSuppliersQuery,
  type UpdateSupplierContactInput,
  type UpdateSupplierInput,
  type UpdateSupplierRatingInput,
  type UpdateSupplierStatusInput,
} from "@top/validation";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AccessTokenClaims } from "../common/types/authenticated-request";
import { SuppliersService } from "./suppliers.service";

/**
 * M3.2 (Architecture Gate Revision 1, locked RBAC matrix — R8/D8). Internal
 * Supplier Master only: EMPLOYEE/APPROVER/SUPPLIER never appear in any
 * @Roles() list here, in any form. Status changes (a more consequential,
 * org-wide-impact action, mirroring PurchaseRequest's cancel-APPROVED
 * precedent) are ADMIN/PROCUREMENT_MANAGER only — narrower than every other
 * endpoint, which also allows PROCUREMENT_SPECIALIST.
 */
@Controller("api/v1/suppliers")
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST")
  @Post()
  create(@CurrentUser() user: AccessTokenClaims, @Body(new ZodValidationPipe(createSupplierSchema)) body: CreateSupplierInput) {
    return this.suppliers.create(user.organizationId, user.sub, body);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST")
  @Get()
  list(@CurrentUser() user: AccessTokenClaims, @Query(new ZodValidationPipe(listSuppliersQuerySchema)) query: ListSuppliersQuery) {
    return this.suppliers.list(user.organizationId, query);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST")
  @Get(":id")
  get(@CurrentUser() user: AccessTokenClaims, @Param("id") id: string) {
    return this.suppliers.get(user.organizationId, id);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST")
  @Patch(":id")
  update(
    @CurrentUser() user: AccessTokenClaims,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateSupplierSchema)) body: UpdateSupplierInput
  ) {
    return this.suppliers.update(user.organizationId, user.sub, id, body);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER")
  @Patch(":id/status")
  updateStatus(
    @CurrentUser() user: AccessTokenClaims,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateSupplierStatusSchema)) body: UpdateSupplierStatusInput
  ) {
    return this.suppliers.updateStatus(user.organizationId, user.sub, id, body);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST")
  @Patch(":id/rating")
  updateRating(
    @CurrentUser() user: AccessTokenClaims,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateSupplierRatingSchema)) body: UpdateSupplierRatingInput
  ) {
    return this.suppliers.updateRating(user.organizationId, user.sub, id, body);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST")
  @Post(":id/contacts")
  addContact(
    @CurrentUser() user: AccessTokenClaims,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createSupplierContactSchema)) body: CreateSupplierContactInput
  ) {
    return this.suppliers.addContact(user.organizationId, user.sub, id, body);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST")
  @Patch(":id/contacts/:contactId")
  updateContact(
    @CurrentUser() user: AccessTokenClaims,
    @Param("id") id: string,
    @Param("contactId") contactId: string,
    @Body(new ZodValidationPipe(updateSupplierContactSchema)) body: UpdateSupplierContactInput
  ) {
    return this.suppliers.updateContact(user.organizationId, user.sub, id, contactId, body);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST")
  @HttpCode(200)
  @Post(":id/contacts/:contactId/archive")
  archiveContact(@CurrentUser() user: AccessTokenClaims, @Param("id") id: string, @Param("contactId") contactId: string) {
    return this.suppliers.archiveContact(user.organizationId, user.sub, id, contactId);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST")
  @Post(":id/capabilities")
  addCapability(
    @CurrentUser() user: AccessTokenClaims,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(addSupplierCapabilitySchema)) body: AddSupplierCapabilityInput
  ) {
    return this.suppliers.addCapability(user.organizationId, user.sub, id, body);
  }

  @Roles("ADMIN", "PROCUREMENT_MANAGER", "PROCUREMENT_SPECIALIST")
  @Delete(":id/capabilities/:categoryId")
  removeCapability(@CurrentUser() user: AccessTokenClaims, @Param("id") id: string, @Param("categoryId") categoryId: string) {
    return this.suppliers.removeCapability(user.organizationId, user.sub, id, categoryId);
  }
}
