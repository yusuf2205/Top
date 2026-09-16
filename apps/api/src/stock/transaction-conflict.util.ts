import { Prisma } from "@top/database";

/**
 * M2.5 (Architecture Gate Revision 2, Phase E — concurrency). Detects
 * whether a caught error represents a Postgres deadlock (SQLSTATE 40P01) or
 * serialization failure (SQLSTATE 40001) inside an interactive
 * `$transaction`. Prisma unifies BOTH of these under one dedicated error
 * code, P2034 ("Transaction failed due to a write conflict or a deadlock.
 * Please retry your transaction"), specifically so callers don't need to
 * parse raw Postgres SQLSTATE codes themselves — this function is a thin,
 * named wrapper around that one check, not a new detection mechanism.
 *
 * Phase E provides DETECTION only. The actual "retry the whole transaction
 * boundary, never a partial step" loop (Architecture Gate §20 — bounded,
 * e.g. one extra attempt) belongs to the future StockMovementsService,
 * which owns the `$transaction(...)` call site this function's result is
 * meant to gate — that orchestration is explicitly out of Phase E's scope.
 *
 * Empirical note: this is verified against Prisma 5.x's documented error
 * reference, not exercised here against a real induced deadlock (reliably
 * triggering one requires two concurrent transactions racing in opposite
 * lock order, which only becomes a realistic scenario once TRANSFER
 * orchestration exists to construct — see the Architecture Gate's own
 * "Concurrency Test Matrix" A→B vs B→A scenario, planned for that phase).
 */
export function isRetryableTransactionError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034";
}
