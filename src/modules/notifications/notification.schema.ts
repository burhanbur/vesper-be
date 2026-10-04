import { z } from '../../common/openapi/zod.js';

export const NotificationTypeSchema = z.enum(['info', 'error', 'warning']);

export const ListNotificationsQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['created_at', '-created_at']).default('-created_at'),
  is_read: z.enum(['true', 'false']).optional().describe('Explicit true or false; omit for both.'),
  type: NotificationTypeSchema.optional(),
});

export const NotificationIdParamsSchema = z.strictObject({ id: z.uuid() });
export const MarkNotificationReadBodySchema = z.strictObject({});
export const MarkNotificationReadSchema = MarkNotificationReadBodySchema.optional();

// JSON-only values; the annotation describes arbitrary JSON without exposing persistence types.
export const NotificationMetadataSchema = z.json().openapi({
  type: ['object', 'array', 'string', 'number', 'boolean', 'null'],
  description:
    'Trusted server-generated, client-safe JSON only. Never contains credentials or internal secrets.',
});

export const NotificationDtoSchema = z.strictObject({
  id: z.uuid(),
  user_id: z.uuid(),
  type: NotificationTypeSchema,
  title: z.string().min(1).max(255),
  body: z.string().min(1).max(10000),
  metadata: NotificationMetadataSchema.nullable(),
  is_read: z.boolean(),
  read_at: z.iso.datetime().nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

export type ListNotificationsQuery = z.infer<typeof ListNotificationsQuerySchema>;
export type NotificationDto = z.infer<typeof NotificationDtoSchema>;
export type NotificationIdParams = z.infer<typeof NotificationIdParamsSchema>;
