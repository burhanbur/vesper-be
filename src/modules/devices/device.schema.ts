import { z } from '../../common/openapi/zod.js';

export const RegisterDeviceSchema = z.strictObject({
  id: z
    .uuid()
    .optional()
    .describe('Client-generated UUID for retry-safe registration; omit to generate UUIDv7.'),
  name: z.string().trim().min(1).max(120),
  platform: z.enum(['Web', 'iOS', 'Android']),
  app_version: z.string().trim().min(1).max(64),
});

export const ListDevicesQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['created_at', '-created_at']).default('-created_at'),
});

export const DeviceDtoSchema = z.strictObject({
  id: z.uuid(),
  user_id: z.uuid(),
  name: z.string(),
  platform: z.enum(['Web', 'iOS', 'Android']),
  app_version: z.string(),
  last_sync_version: z
    .string()
    .regex(/^\d+$/)
    .describe('Read-only server sync cursor serialized as a decimal string.'),
  last_sync_at: z.iso.datetime().nullable(),
  last_seen_at: z.iso.datetime().nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

export type RegisterDeviceInput = z.infer<typeof RegisterDeviceSchema>;
export type ListDevicesQuery = z.infer<typeof ListDevicesQuerySchema>;
export type DeviceDto = z.infer<typeof DeviceDtoSchema>;
