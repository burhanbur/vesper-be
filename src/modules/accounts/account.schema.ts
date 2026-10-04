import { z } from '../../common/openapi/zod.js';

const MAX_BIGINT = 9223372036854775807n;
export const AccountVersionSchema = z
  .string()
  .regex(/^[1-9]\d{0,18}$/)
  .refine(
    (value) => /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= MAX_BIGINT,
    'Versi di luar batas bigint.',
  )
  .describe('Positive PostgreSQL bigint decimal string.');
export const AccountSequenceSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,18})$/)
  .refine(
    (value) => /^(0|[1-9]\d{0,18})$/.test(value) && BigInt(value) <= MAX_BIGINT,
    'Urutan di luar batas bigint.',
  );
const editable = {
  account_type_id: z.uuid(),
  parent_account_id: z.uuid().nullable(),
  icon: z.string().trim().min(1).max(120).nullable(),
  name: z.string().trim().min(1).max(120),
  currency: z.literal('IDR'),
  description: z.string().max(5000).nullable(),
  is_visible: z.boolean(),
  is_include_total: z.boolean(),
  sequence_order: AccountSequenceSchema,
};
export const CreateAccountSchema = z.strictObject({
  ...editable,
  parent_account_id: editable.parent_account_id.default(null),
  icon: editable.icon.default(null),
  currency: editable.currency.default('IDR'),
  description: editable.description.default(null),
  is_visible: editable.is_visible.default(true),
  is_include_total: editable.is_include_total.default(true),
  sequence_order: AccountSequenceSchema.default('0'),
});
export const UpdateAccountSchema = z
  .strictObject(editable)
  .partial()
  .extend({ version: AccountVersionSchema })
  .refine((input) => Object.keys(input).some((key) => key !== 'version'), {
    message: 'Minimal satu kolom perubahan wajib diisi.',
  });
export const AccountIdParamsSchema = z.strictObject({ id: z.uuid() });
export const DeleteAccountQuerySchema = z.strictObject({ version: AccountVersionSchema });
export const ListAccountsQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z
    .enum(['created_at', '-created_at', 'name', '-name', 'sequence_order', '-sequence_order'])
    .default('sequence_order'),
  account_type_id: z.uuid().optional(),
  parent_account_id: z
    .union([z.uuid(), z.literal('null')])
    .optional()
    .describe('UUID for direct children; literal null for roots; omitted for all accounts.'),
  is_visible: z.enum(['true', 'false']).optional(),
});
export const AccountDtoSchema = z.strictObject({
  ...editable,
  id: z.uuid(),
  user_id: z.uuid(),
  balance: z
    .string()
    .regex(/^-?\d{1,18}\.\d{2}$/)
    .describe('Server-managed decimal(20,2), never a JSON number.'),
  version: AccountVersionSchema,
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  deleted_at: z.iso.datetime().nullable(),
});
export type CreateAccountInput = z.infer<typeof CreateAccountSchema>;
export type UpdateAccountInput = z.infer<typeof UpdateAccountSchema>;
export type ListAccountsQuery = z.infer<typeof ListAccountsQuerySchema>;
export type AccountIdParams = z.infer<typeof AccountIdParamsSchema>;
export type DeleteAccountQuery = z.infer<typeof DeleteAccountQuerySchema>;
export type AccountDto = z.infer<typeof AccountDtoSchema>;
