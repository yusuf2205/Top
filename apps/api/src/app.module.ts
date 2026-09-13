import { Module } from "@nestjs/common";
import { HealthModule } from "./health/health.module";

/**
 * M0 scope: only infrastructure (health checks). Business modules
 * (auth, organizations, users, suppliers, purchase-requests, rfqs, quotes,
 * comparisons, recommendations, approvals, purchase-orders, notifications, ai,
 * audit-log) are added module-by-module starting M1, per
 * ARCHITECTURE.md §11 Development Milestones — not scaffolded speculatively here.
 */
@Module({
  imports: [HealthModule],
})
export class AppModule {}
