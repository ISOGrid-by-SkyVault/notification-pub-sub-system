import { test, describe } from "node:test";
import assert from "node:assert";
import { userView } from "../src/views/UserView";
import { IUser } from "../src/models/User";

describe("UserView Rendering", () => {
  test("renderSingle should correctly format a single user document", () => {
    const mockUser = {
      userId: "u-1",
      name: "Alice",
      email: "alice@example.com",
    } as unknown as IUser;

    const output = userView.renderSingle(mockUser);
    assert.deepStrictEqual(output, {
      userId: "u-1",
      name: "Alice",
      email: "alice@example.com",
    });
  });

  test("renderList should correctly format a list of user documents", () => {
    const mockUsers = [
      { userId: "u-1", name: "Alice", email: "alice@example.com" },
      { userId: "u-2", name: "Bob", email: "bob@example.com" },
    ] as unknown as IUser[];

    const output = userView.renderList(mockUsers);
    assert.strictEqual(output.length, 2);
    assert.deepStrictEqual(output[0], {
      userId: "u-1",
      name: "Alice",
      email: "alice@example.com",
    });
  });
});
