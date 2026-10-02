/**
 * Batch completion: detects when every notification of a batch is terminal and
 * sends the completion webhook exactly once, even when several API replicas
 * and workers reach that conclusion at the same time.
 */
import { dbGateway } from "../gateways/DbGateway";
import { env } from "../config/env";

/**
 * Sends a POST request to the configured completion webhook.
 */
export async function sendBatchCompletionWebhook(batchId: string, total: number): Promise<void> {
  try {
    // Aggregate final terminal statuses
    const notifications = await dbGateway.getNotificationsByBatchId(batchId);
    const summary = {
      total,
      delivered: 0,
      dead: 0,
    };

    notifications.forEach((n) => {
      if (n.status === "delivered") summary.delivered++;
      if (n.status === "dead") summary.dead++;
    });

    const payload = {
      batchId,
      summary,
      completedAt: new Date().toISOString(),
    };

    console.log(`[Completion] Batch ${batchId} completed. Sending webhook to ${env.WEBHOOK_URI} with payload:`, payload);

    const response = await fetch(env.WEBHOOK_URI, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      console.log(`[Completion] Webhook for batch ${batchId} dispatched successfully.`);
    } else {
      console.warn(`[Completion] Webhook for batch ${batchId} responded with status: ${response.status}`);
    }
  } catch (error) {
    console.error(`[Completion] Error sending webhook for batch ${batchId}:`, error);
  }
}

/**
 * Evaluates batch completion and triggers webhook atomically.
 */
export async function checkAndTriggerBatchCompletion(batchId: string): Promise<void> {
  const total = await dbGateway.countBatchNotifications(batchId);
  const finished = await dbGateway.countFinishedNotifications(batchId);

  console.log(`[Completion Check] Batch ${batchId}: total=${total}, finished=${finished}`);

  if (total > 0 && total === finished) {
    // All notifications finished! Attempt atomic transition.
    const transitionedBatch = await dbGateway.transitionBatchToCompleted(batchId);
    if (transitionedBatch) {
      // We were the process to transition this batch. Send the completion webhook.
      await sendBatchCompletionWebhook(batchId, total);
    }
  }
}
