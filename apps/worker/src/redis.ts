import IORedis from "ioredis";
import { loadEnv } from "@top/config";

let connection: IORedis | null = null;

export function getRedisConnection(): IORedis {
  if (!connection) {
    const env = loadEnv();
    connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  }
  return connection;
}
