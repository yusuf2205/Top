/**
 * Docker HEALTHCHECK entrypoint (see docker-compose.yml `worker` service).
 * Worker has no HTTP server, so health is "can it reach Redis" — exits 0/1,
 * which is all `docker compose ps` / Uptime Kuma's Docker check needs.
 */
import IORedis from "ioredis";
import { loadEnv } from "@top/config";

async function main() {
  const env = loadEnv();
  const redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 3000, lazyConnect: true });

  try {
    await redis.connect();
    const pong = await redis.ping();
    await redis.quit();
    process.exit(pong === "PONG" ? 0 : 1);
  } catch {
    process.exit(1);
  }
}

main();
