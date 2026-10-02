process.env.NODE_ENV = "test";

import { test, describe, mock, after, beforeEach } from "node:test";
import assert from "node:assert";
import mongoose from "mongoose";
import Redis from "ioredis";
import { dbGateway } from "../gateways/DbGateway";
import { env } from "../config/env";
import {
  processNotificationJob,
} from "../worker";
import {
  checkAndTriggerBatchCompletion,
} from "../utils/completion";
import { app, testQueue } from "../api-server";
import { Request, Response } from "express";

describe("Worker and SSE Notifications Tests", () => {
  let originalFailureRate: number;

  beforeEach(() => {
    originalFailureRate = env.DISPATCH_FAILURE_RATE;
  });

  after(async () => {
    env.DISPATCH_FAILURE_RATE = originalFailureRate;
    await mongoose.disconnect();
    await testQueue.close();
  });

  describe("Worker Notification Job Processing", () => {
    test("processNotificationJob should process successful dispatch (keep pending, publish to SSE)", async () => {
      // Mock failure rate to 0 to ensure success
      env.DISPATCH_FAILURE_RATE = 0;

      const mockJob = {
        id: "job-1",
        attemptsMade: 0,
        data: {
          notificationId: "notif-123",
          batchId: "batch-456",
          userId: "user-789",
          recipient: "alice@example.com",
          courseName: "Introduction to Cybersecurity",
          message: "Test message",
        },
      };

      const mockPublisher = {
        publish: mock.fn(async (channel: string, message: string) => {
          assert.strictEqual(channel, "user:user-789:notifications");
          const payload = JSON.parse(message);
          assert.strictEqual(payload.type, "notification");
          assert.strictEqual(payload.status, "delivered");
          assert.strictEqual(payload.recipient, "alice@example.com");
          return 1;
        }),
      };

      const updateStatusMock = mock.method(dbGateway, "updateNotificationStatus", async (id: string, update: any) => {
        assert.strictEqual(id, "notif-123");
        assert.strictEqual(update.status, "pending");
        assert.strictEqual(update.attempts, 1);
        assert.ok(update.dispatchedAt instanceof Date);
        return {} as any;
      });

      const countBatchMock = mock.method(dbGateway, "countBatchNotifications", async () => 1);
      const countFinishedMock = mock.method(dbGateway, "countFinishedNotifications", async () => 1);
      const transitionBatchMock = mock.method(dbGateway, "transitionBatchToCompleted", async () => null);

      try {
        await processNotificationJob(mockJob, mockPublisher);
        assert.strictEqual(mockPublisher.publish.mock.callCount(), 1);
        assert.strictEqual(updateStatusMock.mock.callCount(), 1);
        
        // Batch completion check should not be run in worker when userId is present
        assert.strictEqual(countBatchMock.mock.callCount(), 0);
        assert.strictEqual(countFinishedMock.mock.callCount(), 0);
        assert.strictEqual(transitionBatchMock.mock.callCount(), 0);
      } finally {
        updateStatusMock.mock.restore();
        countBatchMock.mock.restore();
        countFinishedMock.mock.restore();
        transitionBatchMock.mock.restore();
      }
    });

    test("processNotificationJob should process failed dispatch and queue retry", async () => {
      // Mock failure rate to 1 to ensure failure
      env.DISPATCH_FAILURE_RATE = 1;

      const mockJob = {
        id: "job-1",
        attemptsMade: 0, // 1st attempt
        data: {
          notificationId: "notif-123",
          batchId: "batch-456",
          userId: "user-789",
          recipient: "alice@example.com",
          courseName: "Introduction to Cybersecurity",
          message: "Test message",
        },
      };

      const mockPublisher = {
        publish: mock.fn(async () => 1),
      };

      const updateStatusMock = mock.method(dbGateway, "updateNotificationStatus", async (id: string, update: any) => {
        assert.strictEqual(id, "notif-123");
        assert.strictEqual(update.status, "pending");
        assert.strictEqual(update.attempts, 1);
        return {} as any;
      });

      try {
        await assert.rejects(
          processNotificationJob(mockJob, mockPublisher),
          /Simulated dispatch failure/
        );
        assert.strictEqual(mockPublisher.publish.mock.callCount(), 0);
        assert.strictEqual(updateStatusMock.mock.callCount(), 1);
      } finally {
        updateStatusMock.mock.restore();
      }
    });

    test("processNotificationJob should mark as dead on final failed attempt", async () => {
      env.DISPATCH_FAILURE_RATE = 1;

      const mockJob = {
        id: "job-1",
        attemptsMade: 2, // 3rd attempt (max)
        data: {
          notificationId: "notif-123",
          batchId: "batch-456",
          userId: "user-789",
          recipient: "alice@example.com",
          courseName: "Introduction to Cybersecurity",
          message: "Test message",
        },
      };

      const mockPublisher = {
        publish: mock.fn(async (channel: string, message: string) => {
          assert.strictEqual(channel, "user:user-789:notifications");
          const payload = JSON.parse(message);
          assert.strictEqual(payload.type, "notification");
          assert.strictEqual(payload.status, "dead");
          assert.strictEqual(payload.attempts, 3);
          return 1;
        }),
      };

      const updateStatusMock = mock.method(dbGateway, "updateNotificationStatus", async (id: string, update: any) => {
        assert.strictEqual(id, "notif-123");
        assert.strictEqual(update.status, "dead");
        assert.strictEqual(update.attempts, 3);
        assert.ok(update.error);
        return {} as any;
      });

      const countBatchMock = mock.method(dbGateway, "countBatchNotifications", async () => 1);
      const countFinishedMock = mock.method(dbGateway, "countFinishedNotifications", async () => 1);
      const transitionBatchMock = mock.method(dbGateway, "transitionBatchToCompleted", async () => null);

      try {
        await assert.rejects(
          processNotificationJob(mockJob, mockPublisher),
          /Dispatch failed after maximum attempts/
        );
        assert.strictEqual(mockPublisher.publish.mock.callCount(), 1);
        assert.strictEqual(updateStatusMock.mock.callCount(), 1);
        assert.strictEqual(countBatchMock.mock.callCount(), 1);
        assert.strictEqual(countFinishedMock.mock.callCount(), 1);
        assert.strictEqual(transitionBatchMock.mock.callCount(), 1);
      } finally {
        updateStatusMock.mock.restore();
        countBatchMock.mock.restore();
        countFinishedMock.mock.restore();
        transitionBatchMock.mock.restore();
      }
    });
  });

  describe("Batch Webhook Dispatching", () => {
    test("checkAndTriggerBatchCompletion should transition batch and trigger webhook exactly once", async () => {
      const countBatchMock = mock.method(dbGateway, "countBatchNotifications", async () => 3);
      const countFinishedMock = mock.method(dbGateway, "countFinishedNotifications", async () => 3);
      
      const mockBatch = {
        batchId: "batch-456",
        courseName: "Web Security",
        status: "completed",
      };

      const transitionBatchMock = mock.method(dbGateway, "transitionBatchToCompleted", async (id: string) => {
        assert.strictEqual(id, "batch-456");
        return mockBatch as any;
      });

      const getNotificationsMock = mock.method(dbGateway, "getNotificationsByBatchId", async () => {
        return [
          { status: "delivered" },
          { status: "delivered" },
          { status: "dead" },
        ] as any[];
      });

      let fetchCalled = false;
      const fetchMock = mock.method(globalThis, "fetch", async (url: any, options: any) => {
        fetchCalled = true;
        assert.strictEqual(url, env.WEBHOOK_URI);
        assert.strictEqual(options.method, "POST");
        const body = JSON.parse(options.body);
        assert.strictEqual(body.batchId, "batch-456");
        assert.strictEqual(body.summary.total, 3);
        assert.strictEqual(body.summary.delivered, 2);
        assert.strictEqual(body.summary.dead, 1);
        return { ok: true, status: 200 } as any;
      });

      try {
        await checkAndTriggerBatchCompletion("batch-456");
        assert.ok(fetchCalled);
      } finally {
        countBatchMock.mock.restore();
        countFinishedMock.mock.restore();
        transitionBatchMock.mock.restore();
        getNotificationsMock.mock.restore();
        fetchMock.mock.restore();
      }
    });
  });

  describe("SSE Notifications Express Route", () => {
    test("SSE route /users/:user_uuid/notifications establishes SSE and confirms delivery in DB on message", async () => {
      let messageCallback: ((channel: string, message: string) => void) | null = null;
      let onCalled = false;
      let subscribeCalled = false;
      let unsubscribeCalled = false;
      let quitCalled = false;

      // Mock ioredis prototype
      const subscribeMock = mock.method(Redis.prototype, "subscribe", async function(chan: string) {
        assert.strictEqual(chan, "user:user-uuid-999:notifications");
        subscribeCalled = true;
        return "OK";
      });

      const onMock = mock.method(Redis.prototype, "on", function(this: any, event: string, callback: any) {
        if (event === "message") {
          onCalled = true;
          messageCallback = callback;
        }
        return this;
      });

      const unsubscribeMock = mock.method(Redis.prototype, "unsubscribe", async function() {
        unsubscribeCalled = true;
        return 1;
      });

      const quitMock = mock.method(Redis.prototype, "quit", async function() {
        quitCalled = true;
        return "OK";
      });

      // Mock DB updates triggered by SSE message write
      let sseDbConfirmed = false;
      const updateStatusMock = mock.method(dbGateway, "updateNotificationStatus", async (id: string, update: any) => {
        assert.strictEqual(id, "notif-abc");
        assert.strictEqual(update.status, "delivered");
        sseDbConfirmed = true;
        return {} as any;
      });

      const countBatchMock = mock.method(dbGateway, "countBatchNotifications", async () => 1);
      const countFinishedMock = mock.method(dbGateway, "countFinishedNotifications", async () => 1);
      const transitionBatchMock = mock.method(dbGateway, "transitionBatchToCompleted", async () => null);
      const getPendingMock = mock.method(dbGateway, "getPendingNotificationsForUser", async () => []);

      // Prepare request/response mocks
      const reqListeners: Record<string, () => void> = {};
      const req = {
        params: { user_uuid: "user-uuid-999" },
        on: (event: string, callback: () => void) => {
          reqListeners[event] = callback;
        },
      } as unknown as Request;

      const resWrites: string[] = [];
      let headersWritten = false;
      let ended = false;

      const res = {
        writeHead: (status: number, headers: any) => {
          assert.strictEqual(status, 200);
          assert.strictEqual(headers["Content-Type"], "text/event-stream");
          headersWritten = true;
          return res;
        },
        write: (chunk: string) => {
          resWrites.push(chunk);
          return true;
        },
        end: () => {
          ended = true;
          return res;
        },
      } as unknown as Response;

      // Find routing handler in Express app for this route
      const sseRoute = app._router.stack.find((layer: any) => {
        return layer.route && layer.route.path === "/users/:user_uuid/notifications";
      });

      assert.ok(sseRoute, "SSE Route layer should exist on Express App router");
      const handler = sseRoute.route.stack[0].handle;

      // Execute route handler
      await handler(req, res);

      // Verify connection initialized correctly
      assert.ok(headersWritten);
      assert.ok(subscribeCalled);
      assert.ok(onCalled);

      // Confirm connection confirmation message sent
      assert.ok(resWrites[0].includes("connected"));

      // Simulate receiving a message from Redis pub/sub
      const mockEvent = {
        type: "notification",
        notificationId: "notif-abc",
        batchId: "batch-xyz",
        status: "delivered",
        recipient: "carol@example.com",
        attempts: 1,
        dispatchedAt: new Date().toISOString(),
      };

      if (messageCallback) {
        await (messageCallback as any)("user:user-uuid-999:notifications", JSON.stringify(mockEvent));
      } else {
        assert.fail("messageCallback not registered");
      }

      // Verify message relayed in correct SSE format
      assert.strictEqual(resWrites.length, 2);
      assert.ok(resWrites[1].includes("data: "));
      assert.ok(resWrites[1].includes("carol@example.com"));

      // Verify DB was confirmed
      assert.ok(sseDbConfirmed, "Database status should be confirmed as delivered when SSE is written");

      // Trigger client termination
      assert.ok(reqListeners["close"]);
      await reqListeners["close"]();

      // Verify cleanup occurred
      assert.ok(unsubscribeCalled);
      assert.ok(quitCalled);

      // Restore mocks
      subscribeMock.mock.restore();
      onMock.mock.restore();
      unsubscribeMock.mock.restore();
      quitMock.mock.restore();
      updateStatusMock.mock.restore();
      countBatchMock.mock.restore();
      countFinishedMock.mock.restore();
      transitionBatchMock.mock.restore();
      getPendingMock.mock.restore();
    });

    test("SSE route /users/:user_uuid/notifications immediately delivers pending backlog notifications", async () => {
      // Mock ioredis prototype
      const subscribeMock = mock.method(Redis.prototype, "subscribe", async () => "OK");
      const onMock = mock.method(Redis.prototype, "on", function(this: any) { return this; });
      const unsubscribeMock = mock.method(Redis.prototype, "unsubscribe", async () => 1);
      const quitMock = mock.method(Redis.prototype, "quit", async () => "OK");

      // Mock database backlog retrieval
      const mockPendingNotifs = [
        {
          notificationId: "notif-backlog-1",
          batchId: "batch-backlog",
          recipient: "dave@example.com",
          attempts: 1,
        },
      ];

      const getPendingMock = mock.method(dbGateway, "getPendingNotificationsForUser", async (userId: string) => {
        assert.strictEqual(userId, "user-uuid-888");
        return mockPendingNotifs as any[];
      });

      let dbConfirmed = false;
      const updateStatusMock = mock.method(dbGateway, "updateNotificationStatus", async (id: string, update: any) => {
        assert.strictEqual(id, "notif-backlog-1");
        assert.strictEqual(update.status, "delivered");
        dbConfirmed = true;
        return {} as any;
      });

      const countBatchMock = mock.method(dbGateway, "countBatchNotifications", async () => 1);
      const countFinishedMock = mock.method(dbGateway, "countFinishedNotifications", async () => 1);
      const transitionBatchMock = mock.method(dbGateway, "transitionBatchToCompleted", async () => null);

      const req = {
        params: { user_uuid: "user-uuid-888" },
        on: () => {},
      } as unknown as Request;

      const resWrites: string[] = [];
      const res = {
        writeHead: () => res,
        write: (chunk: string) => {
          resWrites.push(chunk);
          return true;
        },
      } as unknown as Response;

      // Find routing handler in Express app for this route
      const sseRoute = app._router.stack.find((layer: any) => {
        return layer.route && layer.route.path === "/users/:user_uuid/notifications";
      });

      const handler = sseRoute.route.stack[0].handle;

      // Execute route handler
      await handler(req, res);

      // Verify connection established message AND backlog notification were written
      assert.strictEqual(resWrites.length, 2);
      assert.ok(resWrites[0].includes("connected"));
      assert.ok(resWrites[1].includes("notif-backlog-1"));
      assert.ok(resWrites[1].includes("dave@example.com"));

      // Verify DB update and completion checks were run
      assert.ok(dbConfirmed, "Backlog notification should be updated in DB");
      assert.strictEqual(countBatchMock.mock.callCount(), 1);
      assert.strictEqual(transitionBatchMock.mock.callCount(), 1);

      // Restore mocks
      subscribeMock.mock.restore();
      onMock.mock.restore();
      unsubscribeMock.mock.restore();
      quitMock.mock.restore();
      getPendingMock.mock.restore();
      updateStatusMock.mock.restore();
      countBatchMock.mock.restore();
      countFinishedMock.mock.restore();
      transitionBatchMock.mock.restore();
    });
  });
});
