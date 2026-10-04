import type { Transaction } from '../../generated/prisma/client.js';
import type { TransactionDto } from './transaction.schema.js';

export type TransactionRecord = Transaction;
export function toTransactionDto(record: TransactionRecord): TransactionDto {
  return {
    id: record.id,
    account_id: record.accountId,
    category_id: record.categoryId,
    transfer_id: record.transferId,
    type: record.type,
    amount: record.amount.toFixed(2),
    transacted_at: record.transactedAt.toISOString(),
    description: record.description,
    version: record.version.toString(),
    created_by: record.createdBy,
    updated_by: record.updatedBy,
    deleted_by: record.deletedBy,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
    deleted_at: record.deletedAt?.toISOString() ?? null,
  };
}
