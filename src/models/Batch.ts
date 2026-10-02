/**
 * Batch: one "enroll these recipients in this course" request.
 * Status goes from "queued" to "completed" once every notification of the
 * batch is terminal (delivered or dead).
 */
import mongoose, { Schema, Document } from "mongoose";

export interface IBatch extends Document {
  batchId: string; // UUIDv4
  courseName: string;
  message: string;
  priority: "normal" | "high";
  status: "queued" | "processing" | "completed";
  totalRecipients: number;
  createdAt: Date;
  completedAt?: Date;
}

const BatchSchema = new Schema<IBatch>({
  batchId: { type: String, required: true, unique: true, index: true },
  courseName: { type: String, required: true },
  message: { type: String, required: true },
  priority: { type: String, required: true, enum: ["normal", "high"] },
  status: { type: String, required: true, enum: ["queued", "processing", "completed"], default: "queued" },
  totalRecipients: { type: Number, required: true },
  createdAt: { type: Date, required: true, default: Date.now },
  completedAt: { type: Date },
});

export const BatchModel = mongoose.model<IBatch>("Batch", BatchSchema);
