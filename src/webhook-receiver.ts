/**
 * Webhook receiver (standalone HTTP server, default port 3010).
 *
 * Stands in for the external system that wants to know when a batch is done.
 * The API/worker POST the batch summary to WEBHOOK_URI exactly once per batch
 * (see utils/completion.ts); this service validates the payload and logs it.
 *
 *   POST /webhook  batch-completion event
 *   GET  /health   liveness check
 */
import express from "express";
import { WebhookPayloadSchema } from "./utils/schemas";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3010;

app.post("/webhook", (req, res) => {
  console.log(`[Webhook Receiver] Incoming POST request on /webhook`);
  
  try {
    const validation = WebhookPayloadSchema.safeParse(req.body);
    if (!validation.success) {
      const errorMsg = validation.error.issues[0]?.message || "Validation Error";
      console.warn(`[Webhook Receiver] Validation failed: ${errorMsg}`);
      res.status(400).json({ error: "Bad Request", message: errorMsg });
      return;
    }

    const { batchId, summary, completedAt } = validation.data;

    console.log(`[Webhook Receiver] SUCCESS: Batch Completion Event Received!`);
    console.log(`  - Batch ID: ${batchId}`);
    console.log(`  - Total: ${summary.total}`);
    console.log(`  - Delivered: ${summary.delivered}`);
    console.log(`  - Dead: ${summary.dead}`);
    console.log(`  - Completed At: ${completedAt}`);

    res.status(200).json({ status: "success", message: "Webhook processed successfully" });
  } catch (error) {
    console.error(`[Webhook Receiver] Exception encountered while processing webhook:`, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "healthy" });
});

app.listen(PORT, () => {
  console.log(`[Webhook Receiver] Server running on port ${PORT}`);
});
