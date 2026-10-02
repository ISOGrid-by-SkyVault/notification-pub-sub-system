import { test, describe } from "node:test";
import assert from "node:assert";
import { UserModel } from "../src/models/User";

describe("User Model Validation", () => {
  test("should fail validation if required fields are missing", async () => {
    const user = new UserModel({});
    const err = await user.validate().catch((e) => e);
    
    assert.ok(err);
    assert.strictEqual(err.errors.userId.kind, "required");
    assert.strictEqual(err.errors.name.kind, "required");
    assert.strictEqual(err.errors.email.kind, "required");
  });

  test("should pass validation with all required fields", async () => {
    const user = new UserModel({
      userId: "u-00000000-0000-0000-0000-000000000001",
      name: "Alice Johnson",
      email: "alice@example.com",
    });
    
    const err = await user.validate().catch((e) => e);
    assert.strictEqual(err, undefined);
  });
});
