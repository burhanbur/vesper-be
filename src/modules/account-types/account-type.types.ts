import type { AccountType } from '../../generated/prisma/client.js';
import type { AccountTypeDto } from './account-type.schema.js';

export type AccountTypeRecord = AccountType;
export type AccountTypeMutationResult =
  | { status: 'applied'; record: AccountTypeRecord }
  | { status: 'missing' }
  | { status: 'version_conflict' | 'category_in_use'; record: AccountTypeRecord };

export function toAccountTypeDto(record: AccountTypeRecord): AccountTypeDto {
  return {
    id: record.id,
    user_id: record.userId,
    name: record.name,
    category: record.category,
    version: record.version.toString(),
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
    deleted_at: record.deletedAt?.toISOString() ?? null,
  };
}
