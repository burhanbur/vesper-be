import { AppError } from '../../common/errors/app-error.js';
import { accountCategoryOwner } from '../../common/authorization/account-access.js';
import { toCategoryDto } from './category.types.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type {
  CreateCategoryInput,
  ListCategoriesQuery,
  UpdateCategoryInput,
} from './category.schema.js';
import type { CategoryMutationResult, CategoryRecord } from './category.types.js';

export interface CategoryRepository {
  list(
    userId: string,
    query: ListCategoriesQuery,
  ): Promise<{ items: CategoryRecord[]; total: number }>;
  create(userId: string, id: string, input: CreateCategoryInput): Promise<CategoryRecord>;
  update(userId: string, id: string, input: UpdateCategoryInput): Promise<CategoryMutationResult>;
  softDelete(userId: string, id: string, version: bigint): Promise<CategoryMutationResult>;
}

export class PrismaCategoryRepository implements CategoryRepository {
  constructor(private readonly client: PrismaClient) {}

  async list(userId: string, query: ListCategoriesQuery) {
    return this.client.$transaction(
      async (tx) => {
        const ownerId = query.account_id
          ? await accountCategoryOwner(tx, userId, query.account_id)
          : userId;
        const where: Prisma.CategoryWhereInput = {
          userId: ownerId,
          deletedAt: null,
          ...(query.name === undefined
            ? {}
            : { name: { contains: query.name, mode: 'insensitive' } }),
          ...(query.type === undefined ? {} : { type: query.type }),
        };
        const direction = query.sort.startsWith('-') ? 'desc' : 'asc';
        const orderBy: Prisma.CategoryOrderByWithRelationInput[] = [
          query.sort.endsWith('name') ? { name: direction } : { createdAt: direction },
          { id: direction },
        ];
        const [items, total] = await Promise.all([
          tx.category.findMany({
            where,
            orderBy,
            skip: (query.page - 1) * query.limit,
            take: query.limit,
          }),
          tx.category.count({ where }),
        ]);
        return { items, total };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  create(userId: string, id: string, input: CreateCategoryInput) {
    return this.client.category.create({
      data: { id, userId, name: input.name, type: input.type, version: 1n },
    });
  }

  update(userId: string, id: string, input: UpdateCategoryInput): Promise<CategoryMutationResult> {
    return this.mutate(userId, id, BigInt(input.version), input);
  }

  softDelete(userId: string, id: string, version: bigint): Promise<CategoryMutationResult> {
    return this.mutate(userId, id, version);
  }

  private mutate(
    userId: string,
    id: string,
    version: bigint,
    input?: UpdateCategoryInput,
  ): Promise<CategoryMutationResult> {
    return this.client.$transaction(
      async (tx) => {
        // Owner first, then category: coordinated with account and ledger writers.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}::text, 0))::text`;
        await tx.$queryRaw`SELECT id FROM categories
        WHERE id = ${id}::uuid AND user_id = ${userId}::uuid AND deleted_at IS NULL FOR UPDATE`;
        const where = { id, userId, deletedAt: null };
        const current = await tx.category.findFirst({ where });
        if (!current) return { status: 'missing' };
        if (current.version !== version || current.version === 9223372036854775807n) {
          return { status: 'version_conflict', record: current };
        }
        if (
          input?.type !== undefined &&
          input.type !== current.type &&
          ((await tx.transaction.count({ where: { categoryId: id } })) > 0 ||
            (await tx.budget.count({ where: { categoryId: id } })) > 0 ||
            (await tx.mappingGroupCategory.count({ where: { userCategoryId: id } })) > 0)
        ) {
          throw new AppError({
            statusCode: 409,
            code: 'CATEGORY_TYPE_IN_USE',
            message: 'Tipe kategori dengan riwayat transaksi atau anggaran tidak dapat diubah.',
            errors: { server_data: toCategoryDto(current) },
          });
        }
        const now = new Date();
        const data: Prisma.CategoryUpdateManyMutationInput = {
          version: { increment: 1n },
          updatedAt: now,
          ...(input === undefined
            ? { deletedAt: now }
            : {
                ...(input.name === undefined ? {} : { name: input.name }),
                ...(input.type === undefined ? {} : { type: input.type }),
              }),
        };
        const updated = await tx.category.updateMany({ where: { ...where, version }, data });
        if (updated.count !== 1) {
          const latest = await tx.category.findFirst({ where });
          return latest ? { status: 'version_conflict', record: latest } : { status: 'missing' };
        }
        // Owner-scoped read includes only the tombstone just written by this transaction.
        const record = await tx.category.findFirst({ where: { id, userId } });
        if (!record) throw new Error('Category mutation result missing');
        return { status: 'applied', record };
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }
}
