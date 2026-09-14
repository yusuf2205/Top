import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { createSystemPrismaClient } from "../src/client";

/**
 * Development-only seed: one demo Organization + one User per UserRole
 * (except SUPPLIER, which never logs in — see schema.prisma comment).
 * Refuses to run against NODE_ENV=production (prompt §40: "Production seed
 * не должен автоматически создавать demo users").
 *
 * Password hashing is duplicated here (not imported from apps/api's
 * PasswordService) deliberately: packages/database must not depend on
 * apps/api — wrong direction for a shared package. Same scrypt scheme, see
 * apps/api/src/common/auth/password.service.ts for the full rationale.
 */
const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number }
) => Promise<Buffer>;

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("hex")}$${derivedKey.toString("hex")}`;
}

const DEMO_PASSWORD = "DemoPass123!";

const DEMO_USERS = [
  { role: "ADMIN" as const, fullName: "Demo Admin", email: "admin@demo.toppro.uz" },
  { role: "PROCUREMENT_MANAGER" as const, fullName: "Demo Procurement Manager", email: "pm@demo.toppro.uz" },
  { role: "PROCUREMENT_SPECIALIST" as const, fullName: "Demo Procurement Specialist", email: "specialist@demo.toppro.uz" },
  { role: "APPROVER" as const, fullName: "Demo Approver", email: "approver@demo.toppro.uz" },
  { role: "EMPLOYEE" as const, fullName: "Demo Employee", email: "employee@demo.toppro.uz" },
];

async function main() {
  if (process.env.NODE_ENV === "production") {
    // eslint-disable-next-line no-console
    console.error("[seed] Refusing to run demo seed against NODE_ENV=production. Aborting.");
    process.exit(1);
  }

  const db = createSystemPrismaClient();

  const existing = await db.organization.findFirst({ where: { name: "Demo Organization" } });
  if (existing) {
    // eslint-disable-next-line no-console
    console.log(`[seed] "Demo Organization" already exists (${existing.id}) — skipping, not duplicating.`);
    return;
  }

  const organization = await db.organization.create({
    data: { name: "Demo Organization", legalName: 'ООО "Demo Organization"', defaultCurrency: "UZS" },
  });

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  for (const demo of DEMO_USERS) {
    await db.user.create({
      data: {
        organizationId: organization.id,
        email: demo.email,
        passwordHash,
        fullName: demo.fullName,
        role: demo.role,
      },
    });
  }

  // eslint-disable-next-line no-console
  console.log(`[seed] Created "Demo Organization" (${organization.id}) with ${DEMO_USERS.length} demo users.`);
  // eslint-disable-next-line no-console
  console.log(`[seed] All demo users share the password: ${DEMO_PASSWORD} — development only, never use in production.`);
  for (const demo of DEMO_USERS) {
    // eslint-disable-next-line no-console
    console.log(`[seed]   ${demo.role.padEnd(24)} ${demo.email}`);
  }
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[seed] Failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    const db = createSystemPrismaClient();
    await db.$disconnect();
  });
