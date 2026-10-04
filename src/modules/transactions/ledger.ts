import { AppError } from '../../common/errors/app-error.js';
import { Prisma, type Account } from '../../generated/prisma/client.js';
import { toAccountDto } from '../accounts/account.types.js';
import {
  accessibleAccount,
  lockAccountOwners,
  lockAccountGrants,
} from '../../common/authorization/account-access.js';

const MAX_VERSION = 9223372036854775807n;
const MAX_BALANCE = '999999999999999999.99';
// Preserve exact opposing sums beyond Decimal's default 20-digit precision.
const LedgerDecimal = Prisma.Decimal.clone({ precision: 50 });
export const ownedLedgerAccount = accessibleAccount;
export async function lockLedgerOwner(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}::text, 0))::text`;
}
export async function lockLedgerAccounts(
  tx: Prisma.TransactionClient,
  userId: string,
  accountIds: string[],
  missingStatus: 404 | 422 = 422,
): Promise<Account[]> {
  const ids = [...new Set(accountIds)].sort((a, b) => a.localeCompare(b));
  const where = { id: { in: ids }, ...ownedLedgerAccount(userId) };
  const reject = (): never => {
    throw new AppError({
      statusCode: missingStatus,
      code: 'LEDGER_ACCOUNT_INVALID',
      message: 'Akun aktif yang dapat diakses tidak ditemukan.',
    });
  };
  await lockAccountOwners(tx, ids);
  await lockAccountGrants(tx, userId, ids);
  const accounts = await tx.account.findMany({ where });
  if (accounts.length !== ids.length) reject();
  // All ledger writers: sorted actual owners -> grant locks -> sorted types/accounts.
  for (const id of [...new Set(accounts.map((account) => account.accountTypeId))].sort((a, b) =>
    a.localeCompare(b),
  )) {
    await tx.$queryRaw`SELECT id FROM account_types WHERE id = ${id}::uuid FOR UPDATE`;
  }
  for (const id of ids) {
    await tx.$queryRaw`SELECT id FROM accounts WHERE id = ${id}::uuid FOR UPDATE`;
  }
  const locked = await tx.account.findMany({ where });
  if (locked.length !== ids.length) reject();
  return locked;
}
function malformed(): never {
  throw new AppError({
    statusCode: 409,
    code: 'TRANSFER_LEDGER_INVALID',
    message: 'Data ledger transfer tidak konsisten.',
  });
}
export async function recomputeLedgerBalances(
  tx: Prisma.TransactionClient,
  accounts: Account[],
): Promise<void> {
  for (const account of [...accounts].sort((a, b) => a.id.localeCompare(b.id))) {
    // Linked manual rows and unlinked TRANSFER rows must never silently affect balances.
    const invalid = await tx.transaction.findFirst({
      where: {
        accountId: account.id,
        deletedAt: null,
        OR: [
          { type: 'TRANSFER', transferId: null },
          { type: { not: 'TRANSFER' }, transferId: { not: null } },
        ],
      },
      select: { id: true },
    });
    if (invalid) malformed();
    const sums = await tx.transaction.groupBy({
      by: ['type'],
      where: {
        accountId: account.id,
        deletedAt: null,
        transferId: null,
        type: { in: ['INCOME', 'EXPENSE'] },
      },
      _sum: { amount: true },
    });
    const income = sums.find((sum) => sum.type === 'INCOME')?._sum.amount?.toString() ?? '0';
    const expense = sums.find((sum) => sum.type === 'EXPENSE')?._sum.amount?.toString() ?? '0';
    let balance = new LedgerDecimal(income).minus(expense);
    const legs = await tx.transaction.findMany({
      where: { accountId: account.id, deletedAt: null, type: 'TRANSFER' },
      include: { transfer: { include: { transactions: true } } },
    });
    for (const leg of legs) {
      const transfer = leg.transfer;
      if (
        transfer?.deletedAt !== null ||
        transfer.fromAccountId === transfer.toAccountId ||
        !transfer.amount.isPositive() ||
        !transfer.amount.isFinite() ||
        transfer.transactions.length !== 2
      )
        malformed();
      const from = transfer.transactions.find((row) => row.accountId === transfer.fromAccountId);
      const to = transfer.transactions.find((row) => row.accountId === transfer.toAccountId);
      if (!from || !to || from.id === to.id) malformed();
      for (const row of [from, to]) {
        if (
          row.type !== 'TRANSFER' ||
          row.categoryId !== null ||
          row.deletedAt !== null ||
          row.transferId !== transfer.id ||
          !row.amount.equals(row.id === from.id ? transfer.amount.negated() : transfer.amount) ||
          row.transactedAt.getTime() !== transfer.transactedAt.getTime()
        )
          malformed();
      }
      if (account.id !== transfer.fromAccountId && account.id !== transfer.toAccountId) malformed();
    }
    const transferSum = await tx.transaction.aggregate({
      where: { accountId: account.id, deletedAt: null, type: 'TRANSFER' },
      _sum: { amount: true },
    });
    balance = balance.plus(transferSum._sum.amount?.toString() ?? '0');
    if (
      balance.abs().greaterThan(MAX_BALANCE) ||
      (!balance.equals(account.balance) && account.version === MAX_VERSION)
    ) {
      throw new AppError({
        statusCode: 409,
        code: 'ACCOUNT_LEDGER_LIMIT',
        message: 'Saldo atau versi akun melebihi batas maksimum.',
        errors: { server_data: toAccountDto(account) },
      });
    }
    if (balance.equals(account.balance)) continue;
    const result = await tx.account.updateMany({
      where: { id: account.id, version: account.version, deletedAt: null },
      data: {
        balance: new Prisma.Decimal(balance.toFixed(2)),
        version: { increment: 1n },
        updatedAt: new Date(),
      },
    });
    if (result.count !== 1)
      throw new AppError({
        statusCode: 409,
        code: 'ACCOUNT_VERSION_CONFLICT',
        message: 'Versi akun tidak sesuai.',
        errors: { server_data: toAccountDto(account) },
      });
  }
}
