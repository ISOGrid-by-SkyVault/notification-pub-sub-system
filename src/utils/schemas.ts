/**
 * Zod schemas validating the request bodies accepted by the API and by the
 * webhook receiver.
 */
import { z } from "zod";

// Validator for POST /api/batches payload
export const CreateBatchSchema = z.object({
  courseName: z
    .string({ message: "courseName is required" })
    .min(1, "courseName must be a non-empty string"),
  message: z
    .string({ message: "message is required" })
    .min(1, "message must be a non-empty string"),
  priority: z.enum(["normal", "high"], {
    message: "priority must be either 'normal' or 'high'",
  }),
  recipients: z
    .array(
      z.string().email("All recipients must be valid email addresses")
    )
    .min(1, "recipients must be a non-empty array of email addresses"),
});

// Validator for POST /webhook payload
export const WebhookPayloadSchema = z.object({
  batchId: z
    .string({ message: "batchId is required" })
    .uuid("batchId must be a valid UUIDv4"),
  summary: z.object({
    total: z.number().int().nonnegative(),
    delivered: z.number().int().nonnegative(),
    dead: z.number().int().nonnegative(),
  }, { message: "summary is required" }),
  completedAt: z
    .string({ message: "completedAt is required" })
    .refine((val) => !isNaN(Date.parse(val)), {
      message: "completedAt must be a valid ISO date string",
    }),
});

export type CreateBatchInput = z.infer<typeof CreateBatchSchema>;
export type WebhookPayloadInput = z.infer<typeof WebhookPayloadSchema>;
