/**
 * MongoDB connection and first-run seeding.
 */
import mongoose from "mongoose";
import { env } from "./env";
import { UserModel } from "../models/User";

// Demo users. Their emails are the valid batch recipients and their userId is
// the :user_uuid of the SSE route.
const mockUsers = [
  {
    userId: "u-00000000-0000-0000-0000-000000000001",
    name: "Alice Johnson",
    email: "alice@example.com",
  },
  {
    userId: "u-00000000-0000-0000-0000-000000000002",
    name: "Bob Smith",
    email: "bob@example.com",
  },
  {
    userId: "u-00000000-0000-0000-0000-000000000003",
    name: "Carol Williams",
    email: "carol@example.com",
  },
];

/**
 * Inserts the demo users when the collection is empty.
 */
async function seedUsers(): Promise<void> {
  try {
    const count = await UserModel.countDocuments();
    if (count === 0) {
      await UserModel.insertMany(mockUsers);
      console.log("[Seed] Successfully seeded mock users database.");
    } else {
      console.log("[Seed] Users database already seeded.");
    }
  } catch (error) {
    console.error("[Seed] Error seeding users:", error);
  }
}

/**
 * Connects to MongoDB and seeds the demo users. Exits the process when the
 * database is unreachable so the orchestrator restarts the container.
 */
export async function connectDatabase(): Promise<void> {
  try {
    await mongoose.connect(env.MONGODB_URI);
    console.log("MongoDB connection established successfully.");
    await seedUsers();
  } catch (error) {
    console.error("MongoDB connection failed:", error);
    process.exit(1);
  }
}
