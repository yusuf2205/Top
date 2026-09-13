import { z } from "zod";

/**
 * Single source of truth for environment variables across apps/api, apps/worker
 * and (server-side) apps/web. Nothing in this monorepo reads process.env directly
 * outside this file — see ARCHITECTURE.md §108/§110 ("no hardcoded config, no secrets
 * baked into code") and FINAL-INFRASTRUCTURE-ARCHITECTURE.md (S3-compatible abstraction,
 * configurable domains).
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "staging", "production", "test"]).default("development"),

  // ── Core services ──────────────────────────────────────────
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  // ── Object storage (S3-compatible — MinIO on NAS today, swappable later) ──
  S3_ENDPOINT: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().default("top-documents"),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true), // true for MinIO, false for AWS S3

  // ── Auth ───────────────────────────────────────────────────
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 chars"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 chars"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("7d"),
  PORTAL_TOKEN_SECRET: z.string().min(32, "PORTAL_TOKEN_SECRET must be at least 32 chars"),

  // ── AI providers (AIProvider abstraction — never read directly by business logic) ──
  AI_PRIMARY_PROVIDER: z.enum(["anthropic", "openai"]).default("anthropic"),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  AI_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.85),

  // ── Email (Phase 2-ready, optional for MVP local dev) ──────
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),

  // ── Domains / CORS — never hardcoded per FINAL-INFRASTRUCTURE-ARCHITECTURE.md §18 ──
  WEB_DOMAIN: z.string().default("localhost:3000"),
  API_DOMAIN: z.string().default("localhost:4000"),
  ALLOWED_ORIGINS: z.string().default("http://localhost:3000"),

  // ── Ports ────────────────────────────────────────────────
  API_PORT: z.coerce.number().default(4000),
  WEB_PORT: z.coerce.number().default(3000),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

/** Validates process.env once and caches the result. Throws with a clear message on boot if misconfigured — fail fast, not at first request. */
export function loadEnv(): Env {
  if (cachedEnv) return cachedEnv;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}
