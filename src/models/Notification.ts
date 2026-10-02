/**
 * Notification: one message to one recipient of a batch.
 * "pending" until an SSE client receives it ("delivered") or every dispatch
 * attempt has failed ("dead").
 */
import mongoose, { Schema, Document } from "mongoose";

export interface INotification extends Document {
  notificationId: string; // UUIDv4
  batchId: string; // UUIDv4 references Batch
  recipient: string; // email
  userId?: string; // matched UUIDv4 from Users
  status: "pending" | "delivered" | "dead";
  attempts: number;
  error?: string;
  dispatchedAt?: Date;
  createdAt: Date;
}

const NotificationSchema = new Schema<INotification>({
  notificationId: { type: String, required: true, unique: true, index: true },
  batchId: { type: String, required: true, index: true },
  recipient: { type: String, required: true },
  userId: { type: String, index: true },
  status: { type: String, required: true, enum: ["pending", "delivered", "dead"], default: "pending" },
  attempts: { type: Number, required: true, default: 0 },
  error: { type: String },
  dispatchedAt: { type: Date },
  createdAt: { type: Date, required: true, default: Date.now },
});

// Index to efficiently check for batch completion status
NotificationSchema.index({ batchId: 1, status: 1 });

export const NotificationModel = mongoose.model<INotification>("Notification", NotificationSchema);
