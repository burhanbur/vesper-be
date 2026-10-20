import { AppError } from '../../common/errors/app-error.js';
import { generateId } from '../../common/utils/id.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { NetWorthDtoSchema, type NetWorthDto } from './net-worth.schema.js';

export const netWorthOwnerFilter = (
  userId: string,
  currency: string,
): Prisma.AccountWhereInput => ({
  userId,
  currency,
  deletedAt: null,
  accountType: { userId, deletedAt: null, user: { status: 'ACTIVE', deletedAt: null } },
});
export function netWorthLimit(): never {
  throw new AppError({
    statusCode: 422,
    code: 'NET_WORTH_SCOPE_LIMIT',
    message: 'Jumlah akun atau posisi melebihi batas ringkasan.',
  });
}
export class PrismaNetWorthRepository {
  constructor(private readonly client: PrismaClient) {}
  async findCapture(userId: string, currency: string, date: string): Promise<NetWorthDto | null> {
    const row = await this.client.netWorthObservation.findFirst({
      where: {
        userId,
        currency,
        snapshotDate: new Date(date),
        user: { status: 'ACTIVE', deletedAt: null },
      },
      select: { payload: true },
    });
    return row ? NetWorthDtoSchema.parse(row.payload) : null;
  }
  async capture(userId: string, snapshot: NetWorthDto): Promise<void> {
    // INSERT ON CONFLICT DO NOTHING: concurrent/late readers never replace first evidence.
    await this.client.netWorthObservation.createMany({
      data: [
        {
          id: generateId(),
          userId,
          currency: snapshot.currency,
          snapshotDate: new Date(snapshot.snapshot_date),
          observedAt: new Date(snapshot.observed_at),
          payload: { ...snapshot, balance_basis: 'captured_recorded_ledger' },
        },
      ],
      skipDuplicates: true,
    });
  }
  read(userId: string, currency: string, date: string) {
    return this.client.$transaction(
      async (tx) => {
        const accounts = await tx.account.findMany({
          where: netWorthOwnerFilter(userId, currency),
          select: {
            id: true,
            balance: true,
            isIncludeTotal: true,
            accountType: { select: { category: true } },
            children: { where: { deletedAt: null }, select: { id: true }, take: 1 },
          },
          orderBy: { id: 'asc' },
          take: 1001,
        });
        if (accounts.length > 1000) netWorthLimit();
        const ids = accounts
          .filter((a) => a.isIncludeTotal && a.children.length === 0)
          .map((a) => a.id);
        const positions = await tx.investmentTransaction.groupBy({
          by: ['accountId', 'instrumentId', 'type'],
          where: { accountId: { in: ids }, deletedAt: null, type: { in: ['BUY', 'SELL'] } },
          _sum: { quantity: true },
          orderBy: [{ accountId: 'asc' }, { instrumentId: 'asc' }, { type: 'asc' }],
          take: 10001,
        });
        if (positions.length > 10000) netWorthLimit();
        const instruments = await tx.instrument.findMany({
          where: { id: { in: [...new Set(positions.map((p) => p.instrumentId))] } },
          select: {
            id: true,
            currency: true,
            deletedAt: true,
            prices: {
              where: { priceDate: { lte: new Date(date) } },
              orderBy: { priceDate: 'desc' },
              take: 1,
              select: { closePrice: true, priceDate: true, source: true },
            },
          },
        });
        const obligations = await tx.obligation.findMany({
          where: { userId, currency, deletedAt: null, user: { status: 'ACTIVE', deletedAt: null } },
          include: {
            linkedAccount: {
              select: {
                id: true,
                userId: true,
                currency: true,
                deletedAt: true,
                isIncludeTotal: true,
                balance: true,
                children: { where: { deletedAt: null }, select: { id: true }, take: 1 },
              },
            },
          },
          take: 1001,
        });
        if (obligations.length > 1000) netWorthLimit();
        return { accounts, positions, instruments, obligations };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
type CurrentSource = Awaited<ReturnType<PrismaNetWorthRepository['read']>>;
// Optional only for legacy source adapters; absence must keep the result partial.
export type NetWorthSource = Omit<CurrentSource, 'obligations'> & {
  obligations?: CurrentSource['obligations'];
};
export interface NetWorthRepository {
  read(userId: string, currency: string, date: string): Promise<NetWorthSource>;
  findCapture(userId: string, currency: string, date: string): Promise<NetWorthDto | null>;
  capture(userId: string, snapshot: NetWorthDto): Promise<void>;
}
