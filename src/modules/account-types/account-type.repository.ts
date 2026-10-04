import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type {
  CreateAccountTypeInput,
  ListAccountTypesQuery,
  UpdateAccountTypeInput,
} from './account-type.schema.js';
import type { AccountTypeMutationResult, AccountTypeRecord } from './account-type.types.js';

export interface AccountTypeRepository {
  list(
    userId: string,
    query: ListAccountTypesQuery,
  ): Promise<{ items: AccountTypeRecord[]; total: number }>;
  create(userId: string, id: string, input: CreateAccountTypeInput): Promise<AccountTypeRecord>;
  update(
    userId: string,
    id: string,
    input: UpdateAccountTypeInput,
  ): Promise<AccountTypeMutationResult>;
  softDelete(userId: string, id: string, version: bigint): Promise<AccountTypeMutationResult>;
}

async function hasReferencedAccounts(
  transaction: Prisma.TransactionClient,
  id: string,
): Promise<boolean> {
  // Include every reference, even soft-deleted accounts or inconsistent ownership.
  return (await transaction.account.count({ where: { accountTypeId: id } })) > 0;
}

export class PrismaAccountTypeRepository implements AccountTypeRepository {
  constructor(private readonly client: PrismaClient) {}

  async list(userId: string, query: ListAccountTypesQuery) {
    const where: Prisma.AccountTypeWhereInput = {
      userId,
      deletedAt: null,
      ...(query.name === undefined ? {} : { name: { contains: query.name, mode: 'insensitive' } }),
      ...(query.category === undefined ? {} : { category: query.category }),
    };
    const direction = query.sort.startsWith('-') ? 'desc' : 'asc';
    const orderBy: Prisma.AccountTypeOrderByWithRelationInput[] = [
      query.sort.endsWith('name') ? { name: direction } : { createdAt: direction },
      { id: direction },
    ];
    const [items, total] = await this.client.$transaction(
      [
        this.client.accountType.findMany({
          where,
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          orderBy,
        }),
        this.client.accountType.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { items, total };
  }

  create(userId: string, id: string, input: CreateAccountTypeInput) {
    return this.client.accountType.create({
      data: { id, userId, name: input.name, category: input.category, version: 1n },
    });
  }

  async update(
    userId: string,
    id: string,
    input: UpdateAccountTypeInput,
  ): Promise<AccountTypeMutationResult> {
    return this.mutate(userId, id, BigInt(input.version), input);
  }

  async softDelete(
    userId: string,
    id: string,
    version: bigint,
  ): Promise<AccountTypeMutationResult> {
    return this.mutate(userId, id, version);
  }

  private async mutate(
    userId: string,
    id: string,
    version: bigint,
    input?: UpdateAccountTypeInput,
  ): Promise<AccountTypeMutationResult> {
    return this.client.$transaction(
      async (transaction) => {
        // Shared owner lock always precedes type/account/category/ledger row locks.
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}::text, 0))::text`;
        await transaction.$queryRaw`
        SELECT id FROM account_types
        WHERE id = ${id}::uuid AND user_id = ${userId}::uuid AND deleted_at IS NULL
        FOR UPDATE
      `;
        const where = { id, userId, deletedAt: null };
        const current = await transaction.accountType.findFirst({ where });
        if (!current) return { status: 'missing' };
        if (current.version !== version || current.version === 9223372036854775807n) {
          return { status: 'version_conflict', record: current };
        }
        if (
          input?.category !== undefined &&
          input.category !== current.category &&
          (await hasReferencedAccounts(transaction, id))
        ) {
          return { status: 'category_in_use', record: current };
        }
        const data: Prisma.AccountTypeUpdateManyMutationInput = {
          version: { increment: 1n },
          updatedAt: new Date(),
          ...(input === undefined
            ? { deletedAt: new Date() }
            : {
                ...(input.name === undefined ? {} : { name: input.name }),
                ...(input.category === undefined ? {} : { category: input.category }),
              }),
        };
        const updated = await transaction.accountType.updateMany({
          where: { ...where, version },
          data,
        });
        if (updated.count !== 1) {
          const latest = await transaction.accountType.findFirst({ where });
          return latest ? { status: 'version_conflict', record: latest } : { status: 'missing' };
        }
        // Read the deletion tombstone only within this owner-scoped successful write.
        const record = await transaction.accountType.findFirst({ where: { id, userId } });
        if (!record) throw new Error('Account type mutation result missing');
        return { status: 'applied', record };
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }
}
