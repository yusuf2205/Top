import { Worker } from "bullmq";
import { loadEnv } from "@top/config";
import { getRedisConnection } from "./redis";
import { QUEUE_NAMES } from "./queues";

/**
 * M0 scope: prove the worker boots, connects to Redis, and can process a job —
 * not the real extraction pipeline (that lands in M4, see
 * INFRASTRUCTURE.md §STEP9 sequence diagram: upload → queue → worker → AIProvider
 * → AIExtraction → notify).
 */
async function main() {
  loadEnv(); // fail fast on misconfiguration, same as api
  const connection = getRedisConnection();

  const worker = new Worker(
    QUEUE_NAMES.QUOTE_EXTRACTION,
    async (job) => {
      // eslint-disable-next-line no-console
      console.log(`[worker] received job ${job.id} on ${QUEUE_NAMES.QUOTE_EXTRACTION} (M0 stub — no-op)`);
    },
    { connection }
  );

  worker.on("ready", () => {
    // eslint-disable-next-line no-console
    console.log("[worker] ready, listening for jobs");
  });

  worker.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("[worker] error", err);
  });

  const shutdown = async () => {
    await worker.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[worker] fatal boot error", err);
  process.exit(1);
});
