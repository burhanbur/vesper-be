import { generateId } from '../../common/utils/id.js';
import { AppError } from '../../common/errors/app-error.js';
import { accessibleAccount } from '../../common/authorization/account-access.js';
import { Prisma, type PrismaClient, type Account } from '../../generated/prisma/client.js';
import { lockLedgerAccounts, recomputeLedgerBalances } from './ledger.js';
import {
  CreateTransactionSchema,
  type BatchCreateResult,
  type BatchTransactionItem,
  type CreateTransactionInput,
  type ListTransactionsQuery,
  type UpdateTransactionInput,
} from './transaction.schema.js';
import { toTransactionDto, type TransactionRecord } from './transaction.types.js';

export interface TransactionRepository {
  list(
    userId: string,
    query: ListTransactionsQuery,
  ): Promise<{ items: TransactionRecord[]; total: number }>;
  create(userId: string, id: string, input: CreateTransactionInput): Promise<TransactionRecord>;
  createBatch(userId: string, items: BatchTransactionItem[]): Promise<BatchCreateResult>;
  update(userId: string, id: string, input: UpdateTransactionInput): Promise<TransactionRecord>;
  softDelete(userId: string, id: string, version: bigint): Promise<void>;
}
const MAX_VERSION = 9223372036854775807n;

function missing(): never {
  throw new AppError({
    statusCode: 404,
    code: 'TRANSACTION_NOT_FOUND',
    message: 'Transaksi tidak ditemukan.',
  });
}
function conflict(code: string, message: string, record: TransactionRecord): never {
  throw new AppError({
    statusCode: 409,
    code,
    message,
    errors: { server_data: toTransactionDto(record) },
  });
}
function invalid(code: string, message: string): never {
  throw new AppError({ statusCode: 422, code, message });
}
const ownedAccount = accessibleAccount;

export class PrismaTransactionRepository implements TransactionRepository {
  constructor(private readonly client: PrismaClient) {}

  async list(userId: string, query: ListTransactionsQuery) {
    const dates = query.date_range?.split(',');
    const where: Prisma.TransactionWhereInput = {
      deletedAt: null,
      account: accessibleAccount(userId),
      ...(query.account_id === undefined ? {} : { accountId: query.account_id }),
      ...(query.category_id === undefined ? {} : { categoryId: query.category_id }),
      ...(query.type === undefined ? {} : { type: query.type }),
      ...(dates
        ? { transactedAt: { gte: new Date(dates[0] ?? ''), lte: new Date(dates[1] ?? '') } }
        : {}),
    };
    const direction = query.sort.startsWith('-') ? 'desc' : 'asc';
    const orderBy: Prisma.TransactionOrderByWithRelationInput[] = [
      query.sort.endsWith('transacted_at') ? { transactedAt: direction } : { createdAt: direction },
      { id: direction },
    ];
    const [items, total] = await this.client.$transaction(
      [
        this.client.transaction.findMany({
          where,
          orderBy,
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        this.client.transaction.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { items, total };
  }

  private write<T>(
    _userId: string,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.client.$transaction(
      async (tx) => {
        // lockReferences locks all actual owners before any row locks.
        return operation(tx);
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  private async lockReferences(
    tx: Prisma.TransactionClient,
    userId: string,
    accountIds: string[],
    categoryIds: string[],
    transactionId?: string,
  ): Promise<Account[]> {
    const accounts = await lockLedgerAccounts(tx, userId, accountIds);
    for (const id of [...new Set(categoryIds)].sort((a, b) => a.localeCompare(b))) {
      await tx.$queryRaw`SELECT id FROM categories WHERE id = ${id}::uuid FOR UPDATE`;
    }
    if (transactionId) {
      await tx.$queryRaw`SELECT id FROM transactions WHERE id = ${transactionId}::uuid FOR UPDATE`;
    }
    return accounts;
  }

  private async validate(
    tx: Prisma.TransactionClient,
    userId: string,
    input: CreateTransactionInput,
  ): Promise<void> {
    // Category ownership follows the account type owner, never merely the actor.
    const account = await tx.account.findFirst({
      where: { id: input.account_id, ...ownedAccount(userId) },
      include: { accountType: true },
    });
    if (!account)
      invalid('TRANSACTION_ACCOUNT_INVALID', 'Akun aktif yang dapat diakses tidak ditemukan.');
    const category = await tx.category.findFirst({
      where: {
        id: input.category_id,
        userId: account.accountType.userId,
        deletedAt: null,
        type: input.type,
      },
    });
    if (!category)
      invalid(
        'TRANSACTION_CATEGORY_INVALID',
        'Kategori aktif harus milik pemilik akun dan sesuai tipe transaksi.',
      );
  }

  private recompute(tx: Prisma.TransactionClient, accounts: Account[]): Promise<void> {
    return recomputeLedgerBalances(tx, accounts);
  }

  create(userId: string, id: string, input: CreateTransactionInput): Promise<TransactionRecord> {
    return this.write(userId, async (tx) => {
      const accounts = await this.lockReferences(
        tx,
        userId,
        [input.account_id],
        [input.category_id],
      );
      await this.validate(tx, userId, input);
      const record = await tx.transaction.create({
        data: {
          id,
          accountId: input.account_id,
          categoryId: input.category_id,
          type: input.type,
          amount: new Prisma.Decimal(input.amount),
          transactedAt: new Date(input.transacted_at),
          description: input.description,
          createdBy: userId,
          updatedBy: userId,
          version: 1n,
        },
      });
      await this.recompute(tx, accounts);
      return record;
    });
  }

  update(userId: string, id: string, input: UpdateTransactionInput): Promise<TransactionRecord> {
    return this.mutate(userId, id, BigInt(input.version), input);
  }
  async softDelete(userId: string, id: string, version: bigint): Promise<void> {
    await this.mutate(userId, id, version);
  }

  private mutate(
    userId: string,
    id: string,
    version: bigint,
    input?: UpdateTransactionInput,
  ): Promise<TransactionRecord> {
    return this.write(userId, async (tx) => {
      const where = { id, deletedAt: null, account: ownedAccount(userId) };
      const before = await tx.transaction.findFirst({ where });
      if (!before) missing();
      const accounts = await this.lockReferences(
        tx,
        userId,
        [before.accountId, input?.account_id ?? before.accountId],
        [before.categoryId, input?.category_id].filter(
          (value): value is string => typeof value === 'string',
        ),
        id,
      );
      const current = await tx.transaction.findFirst({ where });
      if (!current) missing();
      if (
        current.accountId !== before.accountId ||
        current.version !== version ||
        current.version === MAX_VERSION
      )
        conflict(
          'TRANSACTION_VERSION_CONFLICT',
          'Versi transaksi tidak sesuai atau telah mencapai batas maksimum.',
          current,
        );
      if (
        await tx.investmentTransaction.findUnique({
          where: { linkedTransactionId: id },
          select: { id: true },
        })
      )
        conflict(
          'TRANSACTION_INVESTMENT_LINKED',
          'Transaksi investasi turunan tidak dapat diubah atau dihapus manual.',
          current,
        );
      if (current.transferId !== null || current.type === 'TRANSFER')
        conflict(
          'TRANSACTION_TRANSFER_LINKED',
          'Transaksi transfer hanya dapat diubah melalui modul transfer.',
          current,
        );
      const now = new Date();
      let data: Prisma.TransactionUncheckedUpdateManyInput = {
        version: { increment: 1n },
        updatedBy: userId,
        updatedAt: now,
      };
      if (input) {
        const parsed = CreateTransactionSchema.safeParse({
          account_id: input.account_id ?? current.accountId,
          category_id: input.category_id ?? current.categoryId,
          type: input.type ?? current.type,
          amount: input.amount ?? current.amount.toFixed(2),
          transacted_at: input.transacted_at ?? current.transactedAt.toISOString(),
          // Explicit null clears the description; ?? would incorrectly retain the old value.
          description: input.description === undefined ? current.description : input.description,
        });
        if (!parsed.success)
          invalid('TRANSACTION_MERGED_INVALID', 'Data transaksi gabungan tidak valid.');
        const merged = parsed.data;
        await this.validate(tx, userId, merged);
        data = {
          ...data,
          accountId: merged.account_id,
          categoryId: merged.category_id,
          type: merged.type,
          amount: new Prisma.Decimal(merged.amount),
          transactedAt: new Date(merged.transacted_at),
          description: merged.description,
        };
      } else data = { ...data, deletedAt: now, deletedBy: userId };
      const result = await tx.transaction.updateMany({ where: { ...where, version }, data });
      if (result.count !== 1) {
        const latest = await tx.transaction.findFirst({ where });
        if (!latest) missing();
        conflict('TRANSACTION_VERSION_CONFLICT', 'Versi transaksi tidak sesuai.', latest);
      }
      await this.recompute(tx, accounts);
      const record = await tx.transaction.findUnique({ where: { id } });
      if (!record) throw new Error('Transaction mutation result missing');
      return record;
    });
  }

  createBatch(userId: string, items: BatchTransactionItem[]): Promise<BatchCreateResult> {
    if (items.length === 0) return Promise.resolve({ count: 0 });

    return this.write(userId, async (tx) => {
      const allAccountIds = new Set<string>();
      for (const item of items) {
        if (item.type === 'TRANSFER') {
          allAccountIds.add(item.from_account_id);
          allAccountIds.add(item.to_account_id);
        } else {
          allAccountIds.add(item.account_id);
        }
      }

      const categoryIds = new Set<string>();
      for (const item of items) {
        if (item.type !== 'TRANSFER') {
          categoryIds.add(item.category_id);
        }
      }

      // Follow single-create lock ordering; re-read active categories only after row locks.
      const accounts = await this.lockReferences(tx, userId, [...allAccountIds], [...categoryIds]);
      const accountMap = new Map(accounts.map((account) => [account.id, account]));
      const accountTypes = await tx.accountType.findMany({
        where: {
          id: { in: [...new Set(accounts.map((account) => account.accountTypeId))] },
          deletedAt: null,
        },
        select: { id: true, userId: true },
      });
      const ownerMap = new Map(
        accountTypes.map((accountType) => [accountType.id, accountType.userId]),
      );

      const categories = await tx.category.findMany({
        where: {
          id: { in: [...categoryIds] },
          deletedAt: null,
        },
      });
      const categoryMap = new Map(categories.map((c) => [c.id, c]));

      for (const item of items) {
        if (item.type !== 'TRANSFER') {
          const account = accountMap.get(item.account_id);
          if (!account) {
            invalid(
              'TRANSACTION_ACCOUNT_INVALID',
              'Akun aktif yang dapat diakses tidak ditemukan.',
            );
          }
          const ownerId = ownerMap.get(account.accountTypeId);
          if (!ownerId) {
            invalid(
              'TRANSACTION_ACCOUNT_INVALID',
              'Akun aktif yang dapat diakses tidak ditemukan.',
            );
          }
          const category = categoryMap.get(item.category_id);
          if (category?.userId !== ownerId || category.type !== item.type) {
            invalid(
              'TRANSACTION_CATEGORY_INVALID',
              'Kategori aktif harus milik pemilik akun dan sesuai tipe transaksi.',
            );
          }
        } else {
          if (item.from_account_id === item.to_account_id) {
            invalid('TRANSFER_ACCOUNTS_DISTINCT', 'Akun asal dan tujuan harus berbeda.');
          }
          const from = accountMap.get(item.from_account_id);
          const to = accountMap.get(item.to_account_id);
          if (!from || !to || from.currency !== 'IDR' || to.currency !== 'IDR') {
            invalid(
              'TRANSFER_CURRENCY_MISMATCH',
              'Akun asal dan tujuan harus memiliki mata uang yang sama.',
            );
          }
        }
      }

      const txRows: Prisma.TransactionCreateManyInput[] = [];
      const transferRows: Prisma.TransferCreateManyInput[] = [];

      for (const item of items) {
        if (item.type === 'TRANSFER') {
          const transferId = generateId();
          const amount = new Prisma.Decimal(item.amount);
          const transactedAt = new Date(item.transacted_at);

          transferRows.push({
            id: transferId,
            fromAccountId: item.from_account_id,
            toAccountId: item.to_account_id,
            amount,
            transactedAt,
            description: item.description,
            createdBy: userId,
            updatedBy: userId,
            version: 1n,
          });

          txRows.push(
            {
              id: generateId(),
              accountId: item.from_account_id,
              categoryId: null,
              transferId,
              type: 'TRANSFER',
              amount: amount.negated(),
              transactedAt,
              description: item.description,
              createdBy: userId,
              updatedBy: userId,
              version: 1n,
            },
            {
              id: generateId(),
              accountId: item.to_account_id,
              categoryId: null,
              transferId,
              type: 'TRANSFER',
              amount,
              transactedAt,
              description: item.description,
              createdBy: userId,
              updatedBy: userId,
              version: 1n,
            },
          );
        } else {
          txRows.push({
            id: generateId(),
            accountId: item.account_id,
            categoryId: item.category_id,
            type: item.type,
            amount: new Prisma.Decimal(item.amount),
            transactedAt: new Date(item.transacted_at),
            description: item.description,
            createdBy: userId,
            updatedBy: userId,
            version: 1n,
          });
        }
      }

      if (transferRows.length > 0) {
        await tx.transfer.createMany({ data: transferRows });
      }
      if (txRows.length > 0) {
        await tx.transaction.createMany({ data: txRows });
      }

      await this.recompute(tx, accounts);

      return { count: items.length };
    });
  }
}
