import type { Transfer } from '../../generated/prisma/client.js';
import type { TransferDto } from './transfer.schema.js';

export type TransferRecord = Transfer & { fromTransactionId: string; toTransactionId: string };
export function toTransferDto(record: TransferRecord): TransferDto {
  return {
    id: record.id,
    from_account_id: record.fromAccountId,
    to_account_id: record.toAccountId,
    from_transaction_id: record.fromTransactionId,
    to_transaction_id: record.toTransactionId,
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
