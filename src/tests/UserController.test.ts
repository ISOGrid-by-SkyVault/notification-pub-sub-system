process.env.NODE_ENV = "test";

import { test, describe, mock, after } from "node:test";
import assert from "node:assert";
import mongoose from "mongoose";
import { Request, Response } from "express";
import { userController } from "../controllers/UserController";
import { userManager } from "../managers/UserManager";
import { IUser } from "../models/User";

describe("UserController Request Handlers", () => {
  after(async () => {
    await mongoose.disconnect();
  });
  test("listUsers should return user list JSON payload and 200 status code", async () => {
    const mockUsers = [
      { userId: "u-1", name: "Alice", email: "alice@example.com" },
    ] as unknown as IUser[];

    const getAllUsersMock = mock.method(userManager, "getAllUsers", async () => {
      return mockUsers;
    });

    const req = {} as Request;
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

    try {
      await userController.listUsers(req, res);
      
      assert.strictEqual(resStatus, 200);
      assert.deepStrictEqual(resData, [
        { userId: "u-1", name: "Alice", email: "alice@example.com" },
      ]);
    } finally {
      getAllUsersMock.mock.restore();
    }
  });

  test("listUsers should return 500 status code on manager query errors", async () => {
    const getAllUsersMock = mock.method(userManager, "getAllUsers", async () => {
      throw new Error("Mongoose failure");
    });

    const req = {} as Request;
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

    try {
      await userController.listUsers(req, res);
      
      assert.strictEqual(resStatus, 500);
      assert.strictEqual(resData.error, "Internal Server Error");
      assert.strictEqual(resData.message, "Mongoose failure");
    } finally {
      getAllUsersMock.mock.restore();
    }
  });
});
