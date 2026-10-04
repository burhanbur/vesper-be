import type { Category } from '../../generated/prisma/client.js';
import type { CategoryDto } from './category.schema.js';

export type CategoryRecord = Category;
export type CategoryMutationResult =
  | { status: 'applied'; record: CategoryRecord }
  | { status: 'missing' }
  | { status: 'version_conflict'; record: CategoryRecord };

export function toCategoryDto(record: CategoryRecord): CategoryDto {
  return {
    id: record.id,
    user_id: record.userId,
    name: record.name,
    type: record.type,
    version: record.version.toString(),
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
    deleted_at: record.deletedAt?.toISOString() ?? null,
  };
}
