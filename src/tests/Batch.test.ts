process.env.NODE_ENV = "test";

process.on("unhandledRejection", (err) => {
  console.error("DEBUG UNHANDLED REJECTION:", err);
});

import { test, describe, mock, after } from "node:test";
import assert from "node:assert";
import mongoose from "mongoose";
import { Request, Response } from "express";
import { BatchModel } from "../models/Batch";
import { NotificationModel } from "../models/Notification";
import { batchView } from "../views/BatchView";
import { batchController } from "../controllers/BatchController";
import { batchManager } from "../managers/BatchManager";
import { IBatch } from "../models/Batch";
import { INotification } from "../models/Notification";
import { notificationQueue } from "../config/queue";

describe("Batch and Notification Tests", () => {
  after(async () => {
    await notificationQueue.client;
    await notificationQueue.close();
  });
  
  describe("Batch Model Validation", () => {
    test("should fail validation if fields are missing", async () => {
      const batch = new BatchModel({});
      const err = await batch.validate().catch((e) => e);
      assert.ok(err);
      assert.strictEqual(err.errors.batchId.kind, "required");
      assert.strictEqual(err.errors.courseName.kind, "required");
    });

    test("should pass validation with all fields", async () => {
      const batch = new BatchModel({
        batchId: "b-1",
        courseName: "Test Course",
        message: "Hello",
        priority: "high",
        totalRecipients: 1,
      });
      const err = await batch.validate().catch((e) => e);
      assert.strictEqual(err, undefined);
    });
  });

  describe("BatchView Rendering", () => {
    test("renderCreate formats correctly", () => {
      const mockBatch = {
        batchId: "b-1",
        courseName: "Security",
        status: "queued",
        totalRecipients: 3,
        createdAt: new Date("2026-06-10T12:00:00.000Z"),
      } as unknown as IBatch;

      const output = batchView.renderCreate(mockBatch);
      assert.deepStrictEqual(output, {
        batchId: "b-1",
        courseName: "Security",
        status: "queued",
        totalRecipients: 3,
        createdAt: "2026-06-10T12:00:00.000Z",
      });
    });

    test("renderNotificationList formats correctly", () => {
      const mockNotifications = [
        {
          notificationId: "n-1",
          recipient: "test@example.com",
          status: "delivered",
          attempts: 1,
          dispatchedAt: new Date("2026-06-10T12:05:00.000Z"),
        },
      ] as unknown as INotification[];

      const output = batchView.renderNotificationList(mockNotifications);
      assert.strictEqual(output.length, 1);
      assert.deepStrictEqual(output[0], {
        notificationId: "n-1",
        recipient: "test@example.com",
        status: "delivered",
        attempts: 1,
        dispatchedAt: "2026-06-10T12:05:00.000Z",
      });
    });
  });

  describe("BatchController Validations", () => {
    test("createBatch should return 400 validation error if inputs are invalid", async () => {
      const req = {
        body: {
          courseName: "", // invalid
          message: "valid message",
          priority: "high",
          recipients: ["alice@example.com"],
        },
      } as Request;

      let resStatus: number | null = null;
      let resData: any = null;

      const res = {
        status: (code: number) => {
          resStatus = code;
          return res;
        },
        json: (data: any) => {
          resData = data;
          return res;
        },
      } as unknown as Response;

      await batchController.createBatch(req, res);

      assert.strictEqual(resStatus, 400);
      assert.strictEqual(resData.error, "Validation Error");
    });
  });
});
