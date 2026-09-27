import { z } from '../openapi/zod.js';

export const DebugSchema = z.object({
  url: z.url(),
  method: z.string(),
});

export const ErrorDebugSchema = DebugSchema.extend({
  original_message: z.unknown(),
});

export const PaginationSchema = z.object({
  total: z.int().nonnegative(),
  per_page: z.int().positive(),
  current_page: z.int().positive(),
  last_page: z.int().nonnegative(),
  from: z.int().positive().nullable(),
  to: z.int().positive().nullable(),
});

export const ErrorResponseSchema = z.object({
  success: z.literal(false),
  message: z.string(),
  timestamp: z.string(),
  errors: z.unknown().optional(),
  debug: ErrorDebugSchema.optional(),
});

export function createSuccessResponseSchema<T extends z.ZodType>(dataSchema: T) {
  return z.object({
    success: z.literal(true),
    message: z.string().nullable(),
    timestamp: z.string(),
    total_data: z.int().nonnegative(),
    data: dataSchema,
    pagination: PaginationSchema.optional(),
    debug: DebugSchema.optional(),
  });
}
