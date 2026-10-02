/**
 * Notification worker (background process, no HTTP server).
 *
 * Consumes "notification-queue" jobs, simulates an unreliable dispatch and
 * reports the outcome:
 *   - to MongoDB, through the DbGateway
 *   - to the recipient's Redis channel `user:<userId>:notifications`, which
 *     the API relays to the browser over SSE
 *
 * A failed attempt throws so BullMQ retries it with exponential backoff.
 * After DISPATCH_MAX_RETRIES attempts the notification is marked "dead".
 * Run as many replicas as needed: BullMQ hands each job to a single worker.
 */
import { Worker } from "bullmq";
import Redis from "ioredis";
import { connectDatabase } from "./config/db";
import { redisConnection } from "./config/queue";
import { dbGateway } from "./gateways/DbGateway";
import { env } from "./config/env";
import { checkAndTriggerBatchCompletion } from "./utils/completion";

export let publisher: Redis | null = null;
export let worker: Worker | null = null;

// Connect to MongoDB if not in test environment
if (process.env.NODE_ENV !== "test") {
  connectDatabase();
  console.log("[Worker Process] Initializing notifications worker...");
  
  publisher = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD,
  });
}

/**
 * Main processor logic for a single notification job.
 *
 * Outcomes:
 *   - failure, attempts left: record the attempt and throw (BullMQ retries)
 *   - failure, last attempt:  mark "dead", publish it, check batch completion
 *   - success, known user:    publish "delivered" but keep the record
 *                             "pending" until the API confirms that an SSE
 *                             client actually received it
 *   - success, unknown user:  mark "delivered" right away (nobody to stream to)
 *
 * @param job             BullMQ job; `job.data` is built by BatchManager.createBatch
 * @param customPublisher Redis publisher override, used by the tests
 */
export async function processNotificationJob(job: any, customPublisher?: any): Promise<void> {
  const pub = customPublisher || publisher;
  const { notificationId, batchId, userId, recipient, courseName, message } = job.data;
  const currentAttempt = job.attemptsMade + 1;

  console.log(`[Worker] Processing job ${job.id} for recipient ${recipient} (Attempt ${currentAttempt}/${env.DISPATCH_MAX_RETRIES})`);

  // Simulate unreliable dispatch
  const isFailure = Math.random() < env.DISPATCH_FAILURE_RATE;

  if (isFailure) {
    console.warn(`[Worker] Simulated dispatch FAILURE for ${recipient}`);

    if (currentAttempt >= env.DISPATCH_MAX_RETRIES) {
      // Last attempt failed - mark as dead
      const errorMsg = `Dispatch failed after maximum attempts (${env.DISPATCH_MAX_RETRIES})`;
      const dispatchedAt = new Date();
      await dbGateway.updateNotificationStatus(notificationId, {
        status: "dead",
        attempts: currentAttempt,
        error: errorMsg,
        dispatchedAt,
      });

      // Publish SSE progress update if user is mapped
      if (userId && pub) {
        const sseEvent = {
          type: "notification",
          notificationId,
          batchId,
          status: "dead",
          recipient,
          courseName,
          message,
          attempts: currentAttempt,
          error: errorMsg,
          dispatchedAt: dispatchedAt.toISOString(),
        };
        await pub.publish(`user:${userId}:notifications`, JSON.stringify(sseEvent));
      }

      // Check for batch completion
      await checkAndTriggerBatchCompletion(batchId);

      throw new Error(errorMsg);
    } else {
      // Not the last attempt - update database attempts count and throw to trigger BullMQ retry
      await dbGateway.updateNotificationStatus(notificationId, {
        status: "pending",
        attempts: currentAttempt,
      });
      throw new Error(`Simulated dispatch failure, scheduling retry.`);
    }
  } else {
    if (userId) {
      // Dispatch succeeded - update attempts count in database but keep status as "pending"
      // because delivery must be confirmed by the SSE subscription client
      await dbGateway.updateNotificationStatus(notificationId, {
        status: "pending",
        attempts: currentAttempt,
        dispatchedAt: new Date(),
      });

      // Publish SSE progress update for the client to receive and confirm delivery
      if (pub) {
        const sseEvent = {
          type: "notification",
          notificationId,
          batchId,
          status: "delivered",
          recipient,
          courseName,
          message,
          attempts: currentAttempt,
          dispatchedAt: new Date().toISOString(),
        };
        await pub.publish(`user:${userId}:notifications`, JSON.stringify(sseEvent));
      }
    } else {
      // No user mapped - mark as delivered immediately since we can't use SSE stream
      const dispatchedAt = new Date();
      await dbGateway.updateNotificationStatus(notificationId, {
        status: "delivered",
        attempts: currentAttempt,
        dispatchedAt,
      });

      // Check for batch completion
      await checkAndTriggerBatchCompletion(batchId);
    }
  }
}

// Start worker only when not running in test mode
if (process.env.NODE_ENV !== "test") {
  worker = new Worker(
    "notification-queue",
    async (job) => {
      await processNotificationJob(job);
    },
    {
      connection: redisConnection,
    }
  );

  worker.on("ready", () => {
    console.log("[Worker Process] Notification worker connected to Redis and ready.");
  });

  worker.on("failed", (job, err) => {
    console.error(`[Worker] Job ${job?.id} failed:`, err.message);
  });
}
