/**
 * Controller layer for batches: validates the HTTP request, delegates to
 * BatchManager and renders the result with BatchView. No business logic here.
 */
import { Request, Response } from "express";
import { batchManager } from "../managers/BatchManager";
import { batchView } from "../views/BatchView";
import { dbGateway } from "../gateways/DbGateway";

import { CreateBatchSchema } from "../utils/schemas";

export class BatchController {
  /**
   * POST /api/batches
   * Creates an enrollment batch and starts notification dispatches.
   */
  public async createBatch(req: Request, res: Response): Promise<void> {
    try {
      const validation = CreateBatchSchema.safeParse(req.body);
      if (!validation.success) {
        const message = validation.error.issues[0]?.message || "Validation Error";
        res.status(400).json({
          error: "Validation Error",
          message,
          details: validation.error.format(),
        });
        return;
      }

      const { courseName, message: msgText, priority, recipients } = validation.data;

      const batch = await batchManager.createBatch(courseName, msgText, priority, recipients);
      res.status(201).json(batchView.renderCreate(batch));
    } catch (error) {
      console.error("[BatchController] Error creating batch:", error);
      res.status(500).json({
        error: "Internal Server Error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * GET /api/batches/:batchId
   * Retrieves full execution status metrics of a batch.
   */
  public async getBatchStatus(req: Request, res: Response): Promise<void> {
    try {
      const { batchId } = req.params;
      const result = await batchManager.getBatchStatus(batchId);
      
      if (!result) {
        res.status(404).json({ error: "Not Found", message: `Batch ${batchId} was not found` });
        return;
      }

      res.status(200).json(batchView.renderStatus(result.batch, result.summary));
    } catch (error) {
      console.error("[BatchController] Error getting batch status:", error);
      res.status(500).json({
        error: "Internal Server Error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * GET /api/batches/:batchId/notifications
   * Retrieves individual notification dispatch details.
   */
  public async getBatchNotifications(req: Request, res: Response): Promise<void> {
    try {
      const { batchId } = req.params;
      const notifications = await batchManager.getBatchNotifications(batchId);

      if (!notifications) {
        res.status(404).json({ error: "Not Found", message: `Batch ${batchId} was not found` });
        return;
      }

      res.status(200).json(batchView.renderNotificationList(notifications));
    } catch (error) {
      console.error("[BatchController] Error getting batch notifications:", error);
      res.status(500).json({
        error: "Internal Server Error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * GET /api/batches
   * Lists all batches with page/limit pagination.
   */
  public async listBatches(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string || "1", 10);
      const limit = parseInt(req.query.limit as string || "10", 10);

      if (isNaN(page) || page <= 0 || isNaN(limit) || limit <= 0) {
        res.status(400).json({ error: "Validation Error", message: "page and limit must be positive integers" });
        return;
      }

      const { batches, total } = await dbGateway.getBatchesPaginated(page, limit);
      res.status(200).json(batchView.renderList(batches, total, page, limit));
    } catch (error) {
      console.error("[BatchController] Error listing batches:", error);
      res.status(500).json({
        error: "Internal Server Error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const batchController = new BatchController();
