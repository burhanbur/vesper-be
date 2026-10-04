import { z } from '../../common/openapi/zod.js';

export const TransactionVersionSchema = z
  .string()
  .regex(/^[1-9]\d{0,18}$/)
  .refine((value) => BigInt(value) <= 9223372036854775807n, 'Versi melebihi batas bigint.');
export const TransactionAmountSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/)
  .refine((value) => /[1-9]/.test(value), 'Nominal harus lebih besar dari nol.')
  .openapi({
    description: 'Positive decimal(20,2) string; no exponent, sign, leading zeros or JSON numbers.',
    example: '15000.00',
  });
const ManualTypeSchema = z.enum(['INCOME', 'EXPENSE']);
const TimestampSchema = z.iso.datetime({ offset: true, precision: 3 }).openapi({
  description: 'ISO 8601 timestamp with timezone and millisecond precision.',
  example: '2026-10-04T10:00:00.000Z',
});
const fields = {
  account_id: z.uuid(),
  category_id: z.uuid(),
  type: ManualTypeSchema,
  amount: TransactionAmountSchema,
  transacted_at: TimestampSchema,
  description: z.string().trim().min(1).max(5000).nullable(),
};
export const CreateTransactionSchema = z.strictObject({
  ...fields,
  description: fields.description.default(null),
});
export const UpdateTransactionSchema = z
  .strictObject({
    account_id: fields.account_id.optional(),
    category_id: fields.category_id.optional(),
    type: fields.type.optional(),
    amount: fields.amount.optional(),
    transacted_at: fields.transacted_at.optional(),
    description: fields.description.optional(),
    version: TransactionVersionSchema,
  })
  .refine(
    (value) => Object.keys(value).some((key) => key !== 'version'),
    'Minimal satu field harus diubah.',
  );
export const TransactionIdParamsSchema = z.strictObject({ id: z.uuid() });
export const DeleteTransactionQuerySchema = z.strictObject({ version: TransactionVersionSchema });
export const ListTransactionsQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z
    .enum(['created_at', '-created_at', 'transacted_at', '-transacted_at'])
    .default('-transacted_at'),
  account_id: z.uuid().optional(),
  category_id: z.uuid().optional(),
  type: z.enum(['INCOME', 'EXPENSE', 'TRANSFER']).optional(),
  date_range: z
    .string()
    .refine((value) => {
      const parts = value.split(',');
      return (
        parts.length === 2 &&
        parts.every((part) => TimestampSchema.safeParse(part).success) &&
        Date.parse(parts[0] ?? '') <= Date.parse(parts[1] ?? '')
      );
    }, 'Rentang tanggal harus dua timestamp ISO berurutan dipisahkan koma.')
    .optional()
    .openapi({
      description: 'Inclusive start,end timestamps with timezone and milliseconds.',
      example: '2026-10-01T00:00:00.000Z,2026-10-31T23:59:59.999Z',
    }),
});
export const TransactionDtoSchema = z.strictObject({
  id: z.uuid(),
  account_id: z.uuid(),
  category_id: z.uuid().nullable(),
  transfer_id: z.uuid().nullable(),
  type: z.enum(['INCOME', 'EXPENSE', 'TRANSFER']),
  amount: z.string().regex(/^-?(?:0|[1-9]\d{0,17})\.\d{2}$/),
  transacted_at: z.iso.datetime(),
  description: z.string().nullable(),
  version: TransactionVersionSchema,
  created_by: z.uuid(),
  updated_by: z.uuid(),
  deleted_by: z.uuid().nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  deleted_at: z.iso.datetime().nullable(),
});
export type CreateTransactionInput = z.infer<typeof CreateTransactionSchema>;
export type UpdateTransactionInput = z.infer<typeof UpdateTransactionSchema>;
export type ListTransactionsQuery = z.infer<typeof ListTransactionsQuerySchema>;
export type TransactionIdParams = z.infer<typeof TransactionIdParamsSchema>;
export type DeleteTransactionQuery = z.infer<typeof DeleteTransactionQuerySchema>;
export type TransactionDto = z.infer<typeof TransactionDtoSchema>;
