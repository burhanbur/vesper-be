import { z } from '../../common/openapi/zod.js';
import {
  TransactionAmountSchema,
  TransactionVersionSchema,
} from '../transactions/transaction.schema.js';

export const CreateTransferSchema = z
  .strictObject({
    from_account_id: z.uuid(),
    to_account_id: z.uuid(),
    amount: TransactionAmountSchema,
    transacted_at: z.iso.datetime({ offset: true, precision: 3 }),
    description: z.string().trim().min(1).max(5000).nullable().default(null),
  })
  .refine((value) => value.from_account_id !== value.to_account_id, {
    message: 'Akun asal dan tujuan harus berbeda.',
    path: ['to_account_id'],
  });
export const TransferDtoSchema = z.strictObject({
  id: z.uuid(),
  from_account_id: z.uuid(),
  to_account_id: z.uuid(),
  from_transaction_id: z.uuid(),
  to_transaction_id: z.uuid(),
  amount: TransactionAmountSchema,
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
export type CreateTransferInput = z.infer<typeof CreateTransferSchema>;
export type TransferDto = z.infer<typeof TransferDtoSchema>;
