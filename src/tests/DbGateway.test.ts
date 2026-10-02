process.env.NODE_ENV = "test";

import { test, describe, mock, after } from "node:test";
import assert from "node:assert";
import mongoose from "mongoose";
import { dbGateway } from "../gateways/DbGateway";
import { UserModel } from "../models/User";

describe("DbGateway Operations", () => {
  after(async () => {
    await mongoose.disconnect();
  });
  test("getUsers should retrieve users listing", async () => {
    const mockUsers = [
      { userId: "u-1", name: "Alice", email: "alice@example.com" },
      { userId: "u-2", name: "Bob", email: "bob@example.com" },
    ];

    const findMock = mock.method(UserModel, "find", () => {
      return {
        exec: async () => mockUsers,
      };
    });

    try {
      const users = await dbGateway.getUsers();
      assert.strictEqual(users.length, 2);
      assert.strictEqual(users[0].name, "Alice");
      assert.strictEqual(users[1].email, "bob@example.com");
    } finally {
      findMock.mock.restore();
    }
  });
});
