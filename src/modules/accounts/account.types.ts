import type { Account } from '../../generated/prisma/client.js';
import type { AccountDto } from './account.schema.js';

export type AccountRecord = Account;
export function toAccountDto(record: AccountRecord): AccountDto {
  return {
    id: record.id,
    user_id: record.userId,
    account_type_id: record.accountTypeId,
    parent_account_id: record.parentAccountId,
    icon: record.icon,
    name: record.name,
    currency: 'IDR',
    balance: record.balance.toFixed(2),
    description: record.description,
    is_visible: record.isVisible,
    is_include_total: record.isIncludeTotal,
    sequence_order: record.sequenceOrder.toString(),
    version: record.version.toString(),
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
    deleted_at: record.deletedAt?.toISOString() ?? null,
  };
}
