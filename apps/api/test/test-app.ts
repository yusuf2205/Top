import { Test } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import { AppModule } from "../src/app.module";

/**
 * Boots a real Nest application (all modules, guards, interceptors, filters —
 * same as main.ts) against whatever DATABASE_URL/REDIS_URL/etc. are in the
 * environment. Requires a real Postgres reachable there — these are
 * integration tests, not mocked unit tests (see jest.config.js roots).
 * Run via the docker-compose `postgres` service: see README "Running tests".
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.use(cookieParser());
  await app.init();
  return app;
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}
