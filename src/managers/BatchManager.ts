/**
 * Manager layer for batches: the business flow behind the batch endpoints
 * (resolve recipients, persist the batch and its notifications, enqueue jobs).
 */
import crypto from "crypto";
import { dbGateway } from "../gateways/DbGateway";
import { IBatch } from "../models/Batch";
import { INotification } from "../models/Notification";
import { notificationQueue } from "../config/queue";
import { env } from "../config/env";

export class BatchManager {
  /**
   * Creates an enrollment batch, maps recipients to user IDs, 
   * bulk inserts notification records, and enqueues BullMQ worker jobs.
   */
  public async createBatch(
    courseName: string,
    message: string,
    priority: "normal" | "high",
    recipients: string[]
  ): Promise<IBatch> {
    const batchId = crypto.randomUUID();

    // Map recipient emails to seeded User UUIDs
    const matchedUsers = await dbGateway.getUsersByEmails(recipients);
    const emailToUserIdMap = new Map<string, string>();
    matchedUsers.forEach((u) => {
      emailToUserIdMap.set(u.email.toLowerCase(), u.userId);
    });

    // Create the batch record
    const batch = await dbGateway.createBatch({
      batchId,
      courseName,
      message,
      priority,
      status: "queued",
      totalRecipients: recipients.length,
    });

    // Create individual notification records
    const notificationsData: Partial<INotification>[] = recipients.map((email) => {
      const normalizedEmail = email.toLowerCase();
      return {
        notificationId: crypto.randomUUID(),
        batchId,
        recipient: normalizedEmail,
        userId: emailToUserIdMap.get(normalizedEmail),
        status: "pending",
        attempts: 0,
      };
    });

    const notifications = await dbGateway.createNotifications(notificationsData);

    // Enqueue jobs in bulk using BullMQ addBulk for optimal performance
    const jobs = notifications.map((notif) => ({
      name: "notification-dispatch",
      data: {
        notificationId: notif.notificationId,
        batchId: notif.batchId,
        userId: notif.userId,
        recipient: notif.recipient,
        courseName,
        message,
      },
      opts: {
        attempts: env.DISPATCH_MAX_RETRIES,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
        priority: priority === "high" ? 1 : 2, // BullMQ: lower number = higher priority
      },
    }));

    await notificationQueue.addBulk(jobs);

    return batch;
  }

  /**
   * Retrieves batch details and aggregates notification counts.
   */
  public async getBatchStatus(batchId: string): Promise<{ batch: IBatch; summary: any } | null> {
    const batch = await dbGateway.getBatchById(batchId);
    if (!batch) {
      return null;
    }

    const notifications = await dbGateway.getNotificationsByBatchId(batchId);
    
    const summary = {
      total: batch.totalRecipients,
      delivered: 0,
      pending: 0,
      dead: 0,
    };

    notifications.forEach((n) => {
      if (n.status === "delivered") summary.delivered++;
      if (n.status === "pending") summary.pending++;
      if (n.status === "dead") summary.dead++;
    });

    return { batch, summary };
  }

  /**
   * Retrieves list of individual notifications for a batch.
   */
  public async getBatchNotifications(batchId: string): Promise<INotification[] | null> {
    const batch = await dbGateway.getBatchById(batchId);
    if (!batch) {
      return null;
    }
    return dbGateway.getNotificationsByBatchId(batchId);
  }
}

export const batchManager = new BatchManager();
