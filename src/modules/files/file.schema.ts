import { z } from '../../common/openapi/zod.js';

export const FileIdParamsSchema = z.strictObject({
  id: z.uuid(),
});

export const ListFilesQuerySchema = z.strictObject({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).max(120).optional(),
});

export const FileDtoSchema = z.object({
  id: z.uuid(),
  original_name: z.string(),
  mime_type: z.string(),
  extension: z.string(),
  size: z.number().int().nonnegative(),
  checksum: z.string().length(64),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

export type ListFilesQuery = z.infer<typeof ListFilesQuerySchema>;
