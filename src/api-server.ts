/**
 * API server (HTTP, default port 3000).
 *
 *   GET  /                                    sender dashboard (static, client/)
 *   GET  /health                              MongoDB + Redis status
 *   GET  /api/users                           seeded users
 *   POST /api/batches                         create a batch and enqueue its notifications
 *   GET  /api/batches                         list batches (?page=&limit=)
 *   GET  /api/batches/:batchId                batch status and counters
 *   GET  /api/batches/:batchId/notifications  per-recipient results
 *   GET  /users/:user_uuid/notifications      Server-Sent Events stream for one user
 *
 * The API never dispatches notifications itself: it enqueues BullMQ jobs and
 * the worker processes publish the results on Redis Pub/Sub, which the SSE
 * route below relays to the browser.
 */
import express from "express";
import mongoose from "mongoose";
import { Queue } from "bullmq";
import Redis from "ioredis";
import { env } from "./config/env";
import { connectDatabase } from "./config/db";
import { redisConnection } from "./config/queue";
import { userController } from "./controllers/UserController";
import { batchController } from "./controllers/BatchController";
import { dbGateway } from "./gateways/DbGateway";
import { checkAndTriggerBatchCompletion } from "./utils/completion";

export const app = express();
app.use(express.json());
app.use(express.static("client"));

// Enable CORS for browser-based API clients (e.g., Hoppscotch)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Initialize Queue to verify Redis connectivity
export const testQueue = new Queue("test-connection-queue", {
  connection: redisConnection,
});

// User Routes
app.get("/api/users", (req, res) => userController.listUsers(req, res));

// Active SSE connections registry to track open sockets per user UUID
const activeConnections = new Map<string, { res: any; cleanup: () => Promise<void> }>();

// Server-Sent Events (SSE) Route
//
// Events written to the stream (one JSON object per `data:` line):
//   { type: "connected", channel }                      stream is ready
//   { type: "notification", notificationId, batchId,
//     status: "delivered" | "dead", recipient, attempts,
//     dispatchedAt, courseName?, message?, error? }     one dispatch result
//   { type: "stale" }                                   another client took over this
//                                                       user's stream; do not reconnect
//
// Delivery is confirmed here, not in the worker: a notification only becomes
// "delivered" in MongoDB once it has been written to an open stream. Results
// produced while the user was offline stay "pending" and are replayed as a
// backlog when the stream opens.
app.get("/users/:user_uuid/notifications", async (req, res) => {
  const { user_uuid } = req.params;

  // Set SSE response headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Content-Encoding": "none",
  });

  // Keep-alive heartbeat interval to avoid socket timeouts
  const keepAliveInterval = setInterval(() => {
    res.write(": keep-alive\n\n");
  }, 15000);

  // Dedicated subscriber Redis client for SSE connection
  const isTestMode = process.env.NODE_ENV === "test" || process.argv.some(arg => arg.includes("test"));
  const subscriber = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD,
    ...(isTestMode && { lazyConnect: true }),
  });

  const channel = `user:${user_uuid}:notifications`;

  let isCleanedUp = false;
  const cleanup = async () => {
    if (isCleanedUp) return;
    isCleanedUp = true;
    clearInterval(keepAliveInterval);

    // Only clean up the registry if this is the current active connection
    const current = activeConnections.get(user_uuid);
    if (current && current.res === res) {
      activeConnections.delete(user_uuid);
    }

    try {
      if (subscriber.status !== "end") {
        await subscriber.unsubscribe(channel);
        await subscriber.quit();
      }
      console.log(`[SSE] Closed subscriber Redis connection for user: ${user_uuid}`);
    } catch (err) {
      console.error(`[SSE] Error cleaning subscriber user ${user_uuid}:`, err);
    }
  };

  // Check and close any existing stale connection for this user
  const existing = activeConnections.get(user_uuid);
  if (existing) {
    console.log(`[SSE] Closing existing stale connection for user: ${user_uuid}`);
    try {
      existing.res.write(`data: ${JSON.stringify({ type: "stale" })}\n\n`);
      existing.res.end();
    } catch (err) {
      // socket might already be closed
    }
    await existing.cleanup();
  }

  // Register the new connection
  activeConnections.set(user_uuid, { res, cleanup });

  try {
    await subscriber.subscribe(channel);
    
    subscriber.on("message", async (chan, message) => {
      // 1. Relay the message to the SSE subscriber
      res.write(`data: ${message}\n\n`);

      // 2. Since the frontend app subscribed to the user notification accepted it,
      // confirm delivery in the database.
      try {
        const event = JSON.parse(message);
        if (event.type === "notification" && event.status === "delivered") {
          await dbGateway.updateNotificationStatus(event.notificationId, {
            status: "delivered",
            attempts: event.attempts,
            dispatchedAt: new Date(event.dispatchedAt || Date.now()),
          });

          // Check if batch is completed now that a notification reached terminal status
          await checkAndTriggerBatchCompletion(event.batchId);
        }
      } catch (err) {
        console.error("[SSE] Error confirming delivery in database:", err);
      }
    });

    // Send connection established confirmation
    res.write(`data: ${JSON.stringify({ type: "connected", channel })}\n\n`);
    console.log(`[SSE] Client subscribed to notifications channel for user: ${user_uuid}`);

    // Fetch and deliver any pending backlog notifications immediately
    const pendingBacklog = await dbGateway.getPendingNotificationsForUser(user_uuid);
    if (pendingBacklog.length > 0) {
      console.log(`[SSE] Delivering ${pendingBacklog.length} pending backlog notifications for user: ${user_uuid}`);
      for (const notif of pendingBacklog) {
        const attempts = notif.attempts || 1;
        const dispatchedAt = new Date();
        const sseEvent = {
          type: "notification",
          notificationId: notif.notificationId,
          batchId: notif.batchId,
          status: "delivered",
          recipient: notif.recipient,
          attempts,
          dispatchedAt: dispatchedAt.toISOString(),
        };

        // 1. Send it to the client
        res.write(`data: ${JSON.stringify(sseEvent)}\n\n`);

        // 2. Confirm delivery in the database
        await dbGateway.updateNotificationStatus(notif.notificationId, {
          status: "delivered",
          attempts,
          dispatchedAt,
        });

        // 3. Check for batch completion
        await checkAndTriggerBatchCompletion(notif.batchId);
      }
    }
  } catch (err) {
    console.error(`[SSE] Redis subscription failed for user ${user_uuid}:`, err);
    await cleanup();
    res.end();
    return;
  }

  // Handle client socket termination
  req.on("close", cleanup);
});

// Batch Routes
app.post("/api/batches", (req, res) => batchController.createBatch(req, res));
app.get("/api/batches", (req, res) => batchController.listBatches(req, res));
app.get("/api/batches/:batchId", (req, res) => batchController.getBatchStatus(req, res));
app.get("/api/batches/:batchId/notifications", (req, res) => batchController.getBatchNotifications(req, res));

// Also support non-prefixed routes as per requirements
app.get("/batches/:batchId", (req, res) => batchController.getBatchStatus(req, res));
app.get("/batches/:batchId/notifications", (req, res) => batchController.getBatchNotifications(req, res));

// Debug Webhook Receiver Route
app.post("/api/debug/webhook", (req, res) => {
  console.log("[Webhook Debug Receiver] Received completion event:", JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});

app.get("/health", async (req, res) => {
  try {
    const dbStatus = mongoose.connection.readyState === 1 ? "up" : "down";

    // Obtain underlying redis client to ping
    const redisClient = await testQueue.client;
    const pingResponse = await (redisClient as any).ping();
    const redisStatus = pingResponse === "PONG" ? "up" : "down";

    res.status(200).json({
      status: "healthy",
      database: dbStatus,
      redis: redisStatus,
    });
  } catch (err) {
    res.status(500).json({
      status: "unhealthy",
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// Start server if not running in test mode
if (process.env.NODE_ENV !== "test") {
  // Connect to MongoDB
  connectDatabase();

  app.listen(env.PORT, () => {
    console.log(`[API Server] Running on port ${env.PORT}`);
  });
}
