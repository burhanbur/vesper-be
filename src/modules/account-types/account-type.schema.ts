import { z } from '../../common/openapi/zod.js';

export const AccountTypeCategorySchema = z.enum(['CASH', 'INVESTMENT']);
export const AccountTypeVersionSchema = z
  .string()
  .regex(/^[1-9]\d{0,18}$/)
  .refine((value) => BigInt(value) <= 9223372036854775807n, 'Versi di luar batas bigint.')
  .describe('Positive PostgreSQL bigint version as a decimal string, never a JSON number.');

export const CreateAccountTypeSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  category: AccountTypeCategorySchema.default('CASH'),
});
export const UpdateAccountTypeSchema = z
  .strictObject({
    version: AccountTypeVersionSchema,
    name: z.string().trim().min(1).max(120).optional(),
    category: AccountTypeCategorySchema.optional(),
  })
  .refine((input) => input.name !== undefined || input.category !== undefined, {
    message: 'Minimal satu kolom perubahan wajib diisi.',
  });
export const AccountTypeIdParamsSchema = z.strictObject({ id: z.uuid() });
export const DeleteAccountTypeQuerySchema = z.strictObject({ version: AccountTypeVersionSchema });
export const ListAccountTypesQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['created_at', '-created_at', 'name', '-name']).default('-created_at'),
  name: z.string().trim().min(1).max(120).optional().describe('Case-insensitive name substring.'),
  category: AccountTypeCategorySchema.optional(),
});
export const AccountTypeDtoSchema = z.strictObject({
  id: z.uuid(),
  user_id: z.uuid(),
  name: z.string(),
  category: AccountTypeCategorySchema,
  version: AccountTypeVersionSchema,
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  deleted_at: z.iso.datetime().nullable(),
});

export type CreateAccountTypeInput = z.infer<typeof CreateAccountTypeSchema>;
export type UpdateAccountTypeInput = z.infer<typeof UpdateAccountTypeSchema>;
export type ListAccountTypesQuery = z.infer<typeof ListAccountTypesQuerySchema>;
export type AccountTypeIdParams = z.infer<typeof AccountTypeIdParamsSchema>;
export type DeleteAccountTypeQuery = z.infer<typeof DeleteAccountTypeQuerySchema>;
export type AccountTypeDto = z.infer<typeof AccountTypeDtoSchema>;
