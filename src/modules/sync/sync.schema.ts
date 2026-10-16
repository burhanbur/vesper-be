import { z } from '../../common/openapi/zod.js';
import {
  CreateAccountTypeSchema,
  UpdateAccountTypeSchema,
} from '../account-types/account-type.schema.js';
import { CreateAccountSchema, UpdateAccountSchema } from '../accounts/account.schema.js';
import { CreateCategorySchema, UpdateCategorySchema } from '../categories/category.schema.js';
import {
  CreateTransactionSchema,
  UpdateTransactionSchema,
} from '../transactions/transaction.schema.js';
import { PatchProfileSchema } from '../profiles/profile.schema.js';
import { CreateTransferSchema } from '../transfers/transfer.schema.js';
import { CreateInvestmentSchema } from '../investments/investment.schema.js';

export const OfflineInvestmentPayloadSchema = CreateInvestmentSchema.extend({
  type: z.enum(['BUY', 'SELL']),
  cash_account_id: z.uuid(),
  linked_transaction_id: z.uuid(),
});

// Transfer commands are push-only; pulls expose the paired transaction rows.
export const OfflineTransferPayloadSchema = CreateTransferSchema.safeExtend({
  from_transaction_id: z.uuid(),
  to_transaction_id: z.uuid(),
}).refine((value) => value.from_transaction_id !== value.to_transaction_id, {
  message: 'ID ledger transfer harus berbeda.',
});

export const SyncVersionSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,18})$/)
  .refine(
    (value) => /^(0|[1-9]\d{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n,
    'Versi tidak valid.',
  );
export const SyncEntitySchema = z.enum([
  'account_types',
  'accounts',
  'categories',
  'transactions',
  'user_profiles',
  'investment_transactions',
]);
export const PullQuerySchema = z.strictObject({
  device_id: z.uuid(),
  since_version: SyncVersionSchema.default('0'),
  limit: z.coerce.number().int().min(1).max(100).default(100),
  compact: z
    .enum(['true', 'false'])
    .optional()
    .describe(
      'Opt in to latest-per-entity changes, ordered by their latest global commit version.',
    ),
});
const base = { entity_id: z.uuid(), client_version: SyncVersionSchema };
const deletions = z.strictObject({
  ...base,
  entity_type: SyncEntitySchema.exclude(['investment_transactions']),
  operation: z.literal('DELETE'),
  payload: z.null(),
});
export const PushItemSchema = z.union([
  z
    .strictObject({
      entity_id: z.uuid(),
      client_version: z.literal('0'),
      entity_type: z.literal('investment_transactions'),
      operation: z.literal('CREATE'),
      payload: OfflineInvestmentPayloadSchema,
    })
    .refine((value) => value.entity_id !== value.payload.linked_transaction_id, {
      message: 'ID trade dan ledger harus berbeda.',
    }),
  z
    .strictObject({
      entity_id: z.uuid(),
      client_version: z.literal('0'),
      entity_type: z.literal('transfers'),
      operation: z.literal('CREATE'),
      payload: OfflineTransferPayloadSchema,
    })
    .refine(
      (value) =>
        value.entity_id !== value.payload.from_transaction_id &&
        value.entity_id !== value.payload.to_transaction_id,
    ),
  z.strictObject({
    ...base,
    entity_type: z.literal('account_types'),
    operation: z.literal('CREATE'),
    payload: CreateAccountTypeSchema,
  }),
  z.strictObject({
    ...base,
    entity_type: z.literal('account_types'),
    operation: z.literal('UPDATE'),
    payload: z
      .strictObject({
        name: UpdateAccountTypeSchema.shape.name,
        category: UpdateAccountTypeSchema.shape.category,
      })
      .refine((value) => Object.keys(value).length > 0),
  }),
  z.strictObject({
    ...base,
    entity_type: z.literal('accounts'),
    operation: z.literal('CREATE'),
    payload: CreateAccountSchema,
  }),
  z.strictObject({
    ...base,
    entity_type: z.literal('accounts'),
    operation: z.literal('UPDATE'),
    payload: z
      .strictObject(UpdateAccountSchema.shape)
      .omit({ version: true })
      .refine((value) => Object.keys(value).length > 0),
  }),
  z.strictObject({
    ...base,
    entity_type: z.literal('categories'),
    operation: z.literal('CREATE'),
    payload: CreateCategorySchema,
  }),
  z.strictObject({
    ...base,
    entity_type: z.literal('categories'),
    operation: z.literal('UPDATE'),
    payload: z
      .strictObject({
        name: UpdateCategorySchema.shape.name,
        type: UpdateCategorySchema.shape.type,
      })
      .refine((value) => Object.keys(value).length > 0),
  }),
  z.strictObject({
    ...base,
    entity_type: z.literal('transactions'),
    operation: z.literal('CREATE'),
    payload: CreateTransactionSchema,
  }),
  z.strictObject({
    ...base,
    entity_type: z.literal('transactions'),
    operation: z.literal('UPDATE'),
    payload: z
      .strictObject(UpdateTransactionSchema.shape)
      .omit({ version: true })
      .refine((value) => Object.keys(value).length > 0),
  }),
  z.strictObject({
    ...base,
    entity_type: z.literal('user_profiles'),
    operation: z.enum(['CREATE', 'UPDATE']),
    payload: PatchProfileSchema,
  }),
  deletions,
]);
// Validate items separately so one malformed mutation does not abort valid siblings.
export const PushBodySchema = z.strictObject({
  device_id: z.uuid(),
  items: z.array(z.unknown()).min(1).max(100),
});
export const SyncPayloadSchema = z.record(z.string(), z.unknown()).nullable();
export const PullResponseSchema = z.strictObject({
  changes: z.array(
    z.strictObject({
      entity_type: SyncEntitySchema,
      entity_id: z.uuid(),
      operation: z.enum(['CREATE', 'UPDATE', 'DELETE']),
      version: SyncVersionSchema,
      payload: SyncPayloadSchema,
    }),
  ),
  next_version: SyncVersionSchema,
  watermark: SyncVersionSchema,
  has_more: z.boolean(),
});
export const PushResultSchema = z.strictObject({
  index: z.number().int(),
  status: z.enum(['applied', 'conflict', 'rejected']),
  entity_id: z.uuid().optional(),
  server_data: SyncPayloadSchema.optional(),
  message: z.string().optional(),
});
export const PushResponseSchema = z.strictObject({ results: z.array(PushResultSchema) });
export type PushItem = z.infer<typeof PushItemSchema>;
export type PullQuery = z.infer<typeof PullQuerySchema>;
export type PushBody = z.infer<typeof PushBodySchema>;
export type PushResult = z.infer<typeof PushResultSchema>;
