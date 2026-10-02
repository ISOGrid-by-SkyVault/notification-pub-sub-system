/**
 * User: a possible notification recipient. Seeded on first start (config/db.ts).
 */
import mongoose, { Schema, Document } from "mongoose";

export interface IUser extends Document {
  userId: string;
  name: string;
  email: string;
}

const UserSchema = new Schema<IUser>({
  userId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, index: true },
});

export const UserModel = mongoose.model<IUser>("User", UserSchema);
