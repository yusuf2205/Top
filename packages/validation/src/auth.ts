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

export const passwordResetRequestSchema = z.object({
  email: z.string().email(),
});
export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});
export type PasswordResetConfirmInput = z.infer<typeof passwordResetConfirmSchema>;
