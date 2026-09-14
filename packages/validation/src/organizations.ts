import { z } from "zod";

/**
 * UserRole is duplicated here as a zod enum (matching packages/types and the
 * Prisma enum) rather than imported from @top/database, to keep this package's
 * browser bundle free of the Prisma client — same rationale as packages/types.
 */
const userRoleValues = [
  "ADMIN",
  "PROCUREMENT_MANAGER",
  "PROCUREMENT_SPECIALIST",
  "APPROVER",
  "EMPLOYEE",
  "SUPPLIER",
] as const;

export const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(userRoleValues),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const acceptInvitationSchema = z.object({
  token: z.string().min(1),
  fullName: z.string().trim().min(2).max(200),
  password: z.string().min(8),
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

export const updateMemberRoleSchema = z.object({
  role: z.enum(userRoleValues),
});
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  legalName: z.string().trim().max(200).optional(),
  tin: z.string().trim().max(50).optional(),
  defaultCurrency: z.string().trim().length(3).optional(),
  timezone: z.string().trim().max(100).optional(),
});
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
