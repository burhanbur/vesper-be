import { z } from '../../common/openapi/zod.js';

export const ApiKeyIdParamsSchema = z.strictObject({
  id: z.uuid(),
});

export const CreateApiKeySchema = z.strictObject({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  application: z.string().trim().max(120).nullable().optional(),
  ip_whitelist: z.array(z.string().trim().min(1).max(64)).nullable().optional(),
  permissions: z.array(z.string().trim().min(1).max(120)).nullable().optional(),
  rate_limit: z.coerce.number().int().min(1).max(10000).default(60),
  expires_at: z.iso.datetime().nullable().optional(),
});

export const UpdateApiKeySchema = z
  .strictObject({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    application: z.string().trim().max(120).nullable().optional(),
    ip_whitelist: z.array(z.string().trim().min(1).max(64)).nullable().optional(),
    permissions: z.array(z.string().trim().min(1).max(120)).nullable().optional(),
    is_active: z.boolean().optional(),
    rate_limit: z.coerce.number().int().min(1).max(10000).optional(),
    expires_at: z.iso.datetime().nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Minimal satu kolom harus diisi untuk pembaruan.',
  });

export const ListApiKeysQuerySchema = z.strictObject({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  is_active: z
    .enum(['true', 'false'])
    .transform((val) => val === 'true')
    .optional(),
  search: z.string().trim().min(1).max(120).optional(),
});

export const ApiKeyDtoSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  application: z.string().nullable(),
  key_prefix: z.string(),
  ip_whitelist: z.array(z.string()).nullable(),
  permissions: z.array(z.string()).nullable(),
  is_active: z.boolean(),
  rate_limit: z.number().int(),
  last_used_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const ApiKeyCreatedDtoSchema = ApiKeyDtoSchema.extend({
  key: z.string(),
});

export const ApiKeyM2mTestDtoSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  application: z.string().nullable(),
  permissions: z.array(z.string()),
  authenticated: z.literal(true),
});

export type CreateApiKeyInput = z.infer<typeof CreateApiKeySchema>;
export type UpdateApiKeyInput = z.infer<typeof UpdateApiKeySchema>;
export type ListApiKeysQuery = z.infer<typeof ListApiKeysQuerySchema>;
export type ApiKeyDto = z.infer<typeof ApiKeyDtoSchema>;
export type ApiKeyCreatedDto = z.infer<typeof ApiKeyCreatedDtoSchema>;
export type ApiKeyM2mTestDto = z.infer<typeof ApiKeyM2mTestDtoSchema>;
