/**
 * View layer for batches: maps Mongoose documents to the JSON returned by the
 * API, so internal fields (_id, __v) never leak into responses.
 */
import { IBatch } from "../models/Batch";
import { INotification } from "../models/Notification";

export class BatchView {
  /**
   * Renders a basic batch creation/initial status response.
   */
  public renderCreate(batch: IBatch) {
    return {
      batchId: batch.batchId,
      courseName: batch.courseName,
      status: batch.status,
      totalRecipients: batch.totalRecipients,
      createdAt: batch.createdAt.toISOString(),
    };
  }

  /**
   * Renders the complete batch status report including state summary counts.
   */
  public renderStatus(batch: IBatch, summary: { total: number; delivered: number; pending: number; dead: number }) {
    return {
      batchId: batch.batchId,
      courseName: batch.courseName,
      priority: batch.priority,
      summary: {
        total: summary.total,
        delivered: summary.delivered,
        pending: summary.pending,
        dead: summary.dead,
      },
      createdAt: batch.createdAt.toISOString(),
    };
  }

  /**
   * Renders a list of batches with pagination metadata.
   */
  public renderList(batches: IBatch[], total: number, page: number, limit: number) {
    return {
      batches: batches.map((b) => ({
        batchId: b.batchId,
        courseName: b.courseName,
        status: b.status,
        totalRecipients: b.totalRecipients,
        createdAt: b.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
    };
  }

  /**
   * Renders a list of notifications.
   */
  public renderNotificationList(notifications: INotification[]) {
    return notifications.map((n) => {
      const res: any = {
        notificationId: n.notificationId,
        recipient: n.recipient,
        status: n.status,
        attempts: n.attempts,
      };
      if (n.error) res.error = n.error;
      if (n.dispatchedAt) res.dispatchedAt = n.dispatchedAt.toISOString();
      return res;
    });
  }
}

export const batchView = new BatchView();
