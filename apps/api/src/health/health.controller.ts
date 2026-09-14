import { Controller, Get, HttpStatus, Res } from "@nestjs/common";
import type { Response } from "express";
import { createSystemPrismaClient } from "@top/database";
import type { HealthStatus } from "@top/types";
import { Public } from "../common/decorators/public.decorator";

/**
 * Used by the Docker healthcheck (docker-compose.yml) and top-status (Uptime Kuma).
 * Checks Postgres connectivity — the only dependency api cannot function without.
 * Redis/MinIO connectivity checks belong to the modules that actually use them
 * (worker's own healthcheck script covers Redis — see apps/worker/src/healthcheck.ts).
 *
 * @Public(): M1's global JwtAuthGuard would otherwise reject this with 401
 * (no Authorization header on a Docker healthcheck request) — found live on
 * the NAS the first time this deployed: the container itself was fine, only
 * the healthcheck request was being rejected.
 */
@Public()
@Controller("health")
export class HealthController {
  private readonly prisma = createSystemPrismaClient();

  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthStatus> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: "ok",
        service: "api",
        timestamp: new Date().toISOString(),
        checks: { database: "ok" },
      };
    } catch {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return {
        status: "down",
        service: "api",
        timestamp: new Date().toISOString(),
        checks: { database: "down" },
      };
    }
  }
}
