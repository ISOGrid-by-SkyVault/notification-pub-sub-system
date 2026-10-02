/**
 * Runtime configuration, read once from the environment (and from a local
 * .env file when present). Every value has a default suited to running the
 * processes directly on a machine with MongoDB and Redis on localhost.
 */
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();

/**
 * Reads a sensitive setting from NAME, or from the file named by NAME_FILE.
 * The file form is how Docker Swarm and Kubernetes hand secrets to a
 * container (e.g. REDIS_PASSWORD_FILE=/run/secrets/redis_password).
 */
function secret(name: string): string | undefined {
  const file = process.env[`${name}_FILE`];
  if (file) return fs.readFileSync(file, "utf8").trim();
  return process.env[name] || undefined;
}

// Tests always target localhost, whatever the environment says
const isTestMode = process.env.NODE_ENV === "test" || process.argv.some(arg => arg.includes("test"));

export const env = {
  /** Port the API server listens on. */
  PORT: parseInt(process.env.PORT || "3000", 10),
  /** MongoDB connection string, credentials included. Secret: MONGODB_URI or MONGODB_URI_FILE. */
  MONGODB_URI: isTestMode ? "mongodb://localhost:27017/notification_service" : (secret("MONGODB_URI") || "mongodb://localhost:27017/notification_service"),
  /** Redis host and port, used by BullMQ and by Pub/Sub. */
  REDIS_HOST: isTestMode ? "localhost" : (process.env.REDIS_HOST || "localhost"),
  REDIS_PORT: parseInt(process.env.REDIS_PORT || "6379", 10),
  /** Redis password, if the server requires one. Secret: REDIS_PASSWORD or REDIS_PASSWORD_FILE. */
  REDIS_PASSWORD: isTestMode ? undefined : secret("REDIS_PASSWORD"),
  /** ioredis `maxRetriesPerRequest` for the queue connection. */
  REDIS_MAX_RETRIES: parseInt(process.env.REDIS_MAX_RETRIES || "10", 10),
  /** Probability (0 to 1) that a single simulated dispatch attempt fails. */
  DISPATCH_FAILURE_RATE: parseFloat(process.env.DISPATCH_FAILURE_RATE || "0.3"),
  /** Attempts per notification before it is marked "dead". */
  DISPATCH_MAX_RETRIES: parseInt(process.env.DISPATCH_MAX_RETRIES || "3", 10),
  /** URL that receives the batch-completion webhook. */
  WEBHOOK_URI: process.env.WEBHOOK_URI || "http://localhost:3000/api/debug/webhook",
};

// Secrets are never logged: credentials in the MongoDB URI are masked and the
// Redis password is only reported as set or not.
console.log("[Config] Loaded environment variables:", {
  PORT: env.PORT,
  MONGODB_URI: env.MONGODB_URI.replace(/\/\/[^@/]+@/, "//***@"),
  REDIS_HOST: env.REDIS_HOST,
  REDIS_PORT: env.REDIS_PORT,
  REDIS_PASSWORD: env.REDIS_PASSWORD ? "***" : "(none)",
  REDIS_MAX_RETRIES: env.REDIS_MAX_RETRIES,
  DISPATCH_FAILURE_RATE: env.DISPATCH_FAILURE_RATE,
  DISPATCH_MAX_RETRIES: env.DISPATCH_MAX_RETRIES,
  WEBHOOK_URI: env.WEBHOOK_URI,
});
