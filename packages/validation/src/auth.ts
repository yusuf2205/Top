import { z } from "zod";

/**
 * Shared frontend/backend validation — zod schemas here are the single source
 * of truth for request shape, used both as NestJS DTO validation (api) and
 * react-hook-form resolvers (web), so the two never drift.
 *
 * This is the first schema (M1: Auth). Business-module schemas (purchase
 * requests, RFQ, quotes...) are added module-by-module starting M2, not
 * pre-built speculatively here in M0.
 */
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
export type LoginInput = z.infer<typeof loginSchema>;

// Password policy is intentionally centralized here (single source of truth for
// both the register form and any future "change password" flow) rather than
// duplicated per-form — see M1 implementation report for why min(8) alone
// (matching loginSchema) was judged sufficient for MVP over a full complexity
// ruleset (upper/lower/digit/symbol), which the CTO Decision Lock's
// "no speculative complexity" guidance argues against absent a concrete need.
const passwordSchema = z.string().min(8, "Password must be at least 8 characters");

export const registerSchema = z.object({
  organizationName: z.string().trim().min(2).max(200),
  fullName: z.string().trim().min(2).max(200),
  email: z.string().trim().toLowerCase().email(),
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1).optional(), // optional: normally read from httpOnly cookie, not body
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const passwordResetRequestSchema = z.object({
  email: z.string().email(),
});
export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});
export type PasswordResetConfirmInput = z.infer<typeof passwordResetConfirmSchema>;
