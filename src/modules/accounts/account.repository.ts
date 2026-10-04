import { AppError } from '../../common/errors/app-error.js';
import { accessibleAccount } from '../../common/authorization/account-access.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type {
  CreateAccountInput,
  ListAccountsQuery,
  UpdateAccountInput,
} from './account.schema.js';
import { toAccountDto, type AccountRecord } from './account.types.js';

export interface AccountRepository {
  list(
    userId: string,
    query: ListAccountsQuery,
  ): Promise<{ items: AccountRecord[]; total: number }>;
  create(userId: string, id: string, input: CreateAccountInput): Promise<AccountRecord>;
  update(userId: string, id: string, input: UpdateAccountInput): Promise<AccountRecord>;
  softDelete(userId: string, id: string, version: bigint): Promise<void>;
}
const MAX_VERSION = 9223372036854775807n;
function reject(code: string, message: string, record?: AccountRecord): never {
  throw new AppError({
    statusCode: 409,
    code,
    message,
    ...(record ? { errors: { server_data: toAccountDto(record) } } : {}),
  });
}
function missing(): never {
  throw new AppError({
    statusCode: 404,
    code: 'ACCOUNT_NOT_FOUND',
    message: 'Akun tidak ditemukan.',
  });
}
function assertVersion(record: AccountRecord, version: bigint): void {
  if (record.version !== version || record.version === MAX_VERSION) {
    reject(
      'ACCOUNT_VERSION_CONFLICT',
      'Versi akun tidak sesuai atau telah mencapai batas maksimum.',
      record,
    );
  }
}
function editableData(input: UpdateAccountInput): Prisma.AccountUpdateInput {
  return {
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.icon === undefined ? {} : { icon: input.icon }),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.currency === undefined ? {} : { currency: input.currency }),
    ...(input.is_visible === undefined ? {} : { isVisible: input.is_visible }),
    ...(input.is_include_total === undefined ? {} : { isIncludeTotal: input.is_include_total }),
    ...(input.sequence_order === undefined ? {} : { sequenceOrder: BigInt(input.sequence_order) }),
  };
}

export class PrismaAccountRepository implements AccountRepository {
  constructor(private readonly client: PrismaClient) {}

  async list(userId: string, query: ListAccountsQuery) {
    const where: Prisma.AccountWhereInput = {
      ...accessibleAccount(userId),
      ...(query.account_type_id === undefined ? {} : { accountTypeId: query.account_type_id }),
      ...(query.parent_account_id === undefined
        ? {}
        : { parentAccountId: query.parent_account_id === 'null' ? null : query.parent_account_id }),
      ...(query.is_visible === undefined ? {} : { isVisible: query.is_visible === 'true' }),
    };
    const direction = query.sort.startsWith('-') ? 'desc' : 'asc';
    let primaryOrder: Prisma.AccountOrderByWithRelationInput = { createdAt: direction };
    if (query.sort.endsWith('name')) primaryOrder = { name: direction };
    if (query.sort.endsWith('sequence_order')) primaryOrder = { sequenceOrder: direction };
    const orderBy: Prisma.AccountOrderByWithRelationInput[] = [primaryOrder, { id: direction }];
    const [items, total] = await this.client.$transaction(
      [
        this.client.account.findMany({
          where,
          orderBy,
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        this.client.account.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { items, total };
  }

  private write<T>(
    userId: string,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.client.$transaction(
      async (tx) => {
        // Bound SQL: Prisma has no advisory-lock API. Every hierarchy writer takes
        // this owner lock first, then type row locks; hash collisions only serialize extra users.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}::text, 0))::text`;
        return operation(tx);
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  private async lockType(tx: Prisma.TransactionClient, userId: string, id: string): Promise<void> {
    // Same row-lock protocol as account-type category/deletion mutations.
    await tx.$queryRaw`SELECT id FROM account_types WHERE id = ${id}::uuid AND user_id = ${userId}::uuid FOR UPDATE`;
    const type = await tx.accountType.findFirst({ where: { id, userId, deletedAt: null } });
    if (!type)
      throw new AppError({
        statusCode: 422,
        code: 'ACCOUNT_TYPE_INVALID',
        message: 'Tipe akun aktif milik Anda tidak ditemukan.',
      });
  }

  private async validateParent(
    tx: Prisma.TransactionClient,
    userId: string,
    id: string,
    typeId: string,
    parentId: string | null,
  ): Promise<void> {
    const visited = new Set<string>([id]);
    let cursor = parentId;
    // Each lookup depends on the previous parent; the owner lock keeps this chain stable.
    while (cursor !== null) {
      if (visited.has(cursor))
        reject('ACCOUNT_HIERARCHY_CYCLE', 'Hierarki akun tidak boleh membentuk siklus.');
      visited.add(cursor);
      const parent = await tx.account.findFirst({ where: { id: cursor, userId, deletedAt: null } });
      if (parent?.accountTypeId !== typeId) {
        throw new AppError({
          statusCode: 422,
          code: 'ACCOUNT_PARENT_INVALID',
          message: 'Parent harus akun aktif milik Anda dengan tipe yang sama.',
        });
      }
      cursor = parent.parentAccountId;
    }
  }

  private async excludeParent(
    tx: Prisma.TransactionClient,
    userId: string,
    parentId: string | null,
  ): Promise<void> {
    if (parentId === null) return;
    const parent = await tx.account.findFirst({ where: { id: parentId, userId, deletedAt: null } });
    if (!parent) missing();
    if (!parent.isIncludeTotal) return;
    assertVersion(parent, parent.version);
    await tx.account.update({
      where: { id: parent.id },
      data: { isIncludeTotal: false, version: { increment: 1n } },
    });
  }

  create(userId: string, id: string, input: CreateAccountInput): Promise<AccountRecord> {
    return this.write(userId, async (tx) => {
      await this.lockType(tx, userId, input.account_type_id);
      await this.validateParent(tx, userId, id, input.account_type_id, input.parent_account_id);
      const record = await tx.account.create({
        data: {
          id,
          userId,
          accountTypeId: input.account_type_id,
          parentAccountId: input.parent_account_id,
          name: input.name,
          icon: input.icon,
          description: input.description,
          currency: input.currency,
          isVisible: input.is_visible,
          isIncludeTotal: input.is_include_total,
          sequenceOrder: BigInt(input.sequence_order),
          balance: '0',
          version: 1n,
        },
      });
      await this.excludeParent(tx, userId, input.parent_account_id);
      return record;
    });
  }

  update(userId: string, id: string, input: UpdateAccountInput): Promise<AccountRecord> {
    return this.write(userId, async (tx) => {
      const current = await tx.account.findFirst({ where: { id, userId, deletedAt: null } });
      if (!current) missing();
      assertVersion(current, BigInt(input.version));
      const typeId = input.account_type_id ?? current.accountTypeId;
      const parentId =
        input.parent_account_id === undefined ? current.parentAccountId : input.parent_account_id;
      for (const lockedTypeId of [...new Set([current.accountTypeId, typeId])].sort()) {
        await this.lockType(tx, userId, lockedTypeId);
      }
      await tx.$queryRaw`SELECT id FROM accounts WHERE id = ${id}::uuid AND user_id = ${userId}::uuid FOR UPDATE`;
      if (
        typeId !== current.accountTypeId &&
        ((await tx.transaction.count({ where: { accountId: id } })) > 0 ||
          (await tx.investmentTransaction.count({
            where: { OR: [{ accountId: id }, { cashAccountId: id }] },
          })) > 0 ||
          (await tx.portfolioDailySnapshot.count({ where: { accountId: id } })) > 0)
      ) {
        reject(
          'ACCOUNT_TYPE_HAS_TRANSACTIONS',
          'Tipe akun dengan riwayat transaksi tidak dapat diubah.',
          current,
        );
      }
      const hasChildren =
        (await tx.account.count({ where: { parentAccountId: id, deletedAt: null } })) > 0;
      if (hasChildren && typeId !== current.accountTypeId) {
        reject(
          'ACCOUNT_TYPE_HAS_CHILDREN',
          'Tipe akun tidak dapat diubah selama masih memiliki child aktif.',
          current,
        );
      }
      if (hasChildren && input.is_include_total === true) {
        reject(
          'ACCOUNT_TOTAL_HAS_CHILDREN',
          'Akun dengan child aktif tidak boleh disertakan dalam total.',
          current,
        );
      }
      await this.validateParent(tx, userId, id, typeId, parentId);
      const record = await tx.account.update({
        where: { id, userId, deletedAt: null, version: current.version },
        data: {
          ...editableData(input),
          accountType: { connect: { id: typeId } },
          parent: parentId === null ? { disconnect: true } : { connect: { id: parentId } },
          ...(hasChildren ? { isIncludeTotal: false } : {}),
          version: { increment: 1n },
        },
      });
      await this.excludeParent(tx, userId, parentId);
      // The former parent stays excluded; clients may explicitly re-enable a leaf.
      return record;
    });
  }

  softDelete(userId: string, id: string, version: bigint): Promise<void> {
    return this.write(userId, async (tx) => {
      const current = await tx.account.findFirst({ where: { id, userId, deletedAt: null } });
      if (!current) missing();
      assertVersion(current, version);
      if ((await tx.account.count({ where: { parentAccountId: id, deletedAt: null } })) > 0) {
        reject('ACCOUNT_HAS_CHILDREN', 'Akun dengan child aktif tidak dapat dihapus.', current);
      }
      if (!current.balance.isZero())
        reject(
          'ACCOUNT_NONZERO_BALANCE',
          'Akun dengan saldo tidak nol tidak dapat dihapus.',
          current,
        );
      if ((await tx.transaction.count({ where: { accountId: id, deletedAt: null } })) > 0) {
        reject(
          'ACCOUNT_HAS_TRANSACTIONS',
          'Akun dengan transaksi aktif tidak dapat dihapus.',
          current,
        );
      }
      if (
        (await tx.investmentTransaction.count({
          where: { OR: [{ accountId: id }, { cashAccountId: id }] },
        })) > 0 ||
        (await tx.portfolioDailySnapshot.count({ where: { accountId: id } })) > 0
      ) {
        reject(
          'ACCOUNT_HAS_INVESTMENTS',
          'Akun dengan riwayat investasi atau snapshot tidak dapat dihapus.',
          current,
        );
      }
      await this.lockType(tx, userId, current.accountTypeId);
      await tx.$queryRaw`SELECT id FROM accounts WHERE id = ${id}::uuid AND user_id = ${userId}::uuid FOR UPDATE`;
      await tx.account.update({
        where: { id, userId, deletedAt: null, version: current.version },
        data: { deletedAt: new Date(), version: { increment: 1n } },
      });
    });
  }
}
