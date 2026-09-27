import { z } from '../../common/openapi/zod.js';

export const ImportUserRowSchema = z.strictObject({
  name: z.string().trim().min(2).max(120),
  email: z.email().trim().toLowerCase(),
  password: z.string().min(8).max(128),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).default('ACTIVE'),
});

export const UserImportResultSchema = z.object({
  imported: z.number().int().nonnegative(),
  total_rows: z.number().int().nonnegative(),
});

export type ImportUserRow = z.infer<typeof ImportUserRowSchema>;
