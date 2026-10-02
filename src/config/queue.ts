/**
 * BullMQ queue shared by the API (producer) and the workers (consumers).
 */
import { ConnectionOptions, Queue } from "bullmq";
import { env } from "./env";

const isTestMode = process.env.NODE_ENV === "test" || process.argv.some(arg => arg.includes("test"));

/** Redis connection options for BullMQ. Tests connect lazily and never retry. */
export const redisConnection: ConnectionOptions = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD,
  maxRetriesPerRequest: isTestMode ? 0 : env.REDIS_MAX_RETRIES,
  ...(isTestMode && {
    enableOfflineQueue: true,
    lazyConnect: true,
  }),
};

/** One job per recipient; see BatchManager.createBatch for the job payload. */
export const notificationQueue = new Queue("notification-queue", {
  connection: redisConnection,
});

