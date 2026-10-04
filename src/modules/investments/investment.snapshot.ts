import { generateId } from '../../common/utils/id.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { advance, emptyPosition, nextDay, valuation } from './investment.calculation.js';

export async function positionAt(
  tx: Prisma.TransactionClient,
  accountId: string,
  instrumentId: string,
  end?: Date,
) {
  let position = emptyPosition();
  let cursor: string | undefined;
  for (;;) {
    const rows = await tx.investmentTransaction.findMany({
      where: {
        accountId,
        instrumentId,
        deletedAt: null,
        ...(end ? { transactedAt: { lt: end } } : {}),
      },
      orderBy: [{ transactedAt: 'asc' }, { id: 'asc' }],
      take: 250,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const row of rows) position = advance(position, row);
    if (rows.length < 250) return position;
    cursor = rows.at(-1)?.id;
  }
}
export async function refreshSnapshot(
  tx: Prisma.TransactionClient,
  accountId: string,
  instrumentId: string,
  date: Date,
) {
  const price = await tx.instrumentPrice.findFirst({
    where: { instrumentId, priceDate: { lte: date } },
    orderBy: { priceDate: 'desc' },
  });
  if (!price) return;
  const position = await positionAt(
    tx,
    accountId,
    instrumentId,
    nextDay(date.toISOString().slice(0, 10)),
  );
  const data = valuation(position, price.closePrice);
  await tx.portfolioDailySnapshot.upsert({
    where: { accountId_instrumentId_snapshotDate: { accountId, instrumentId, snapshotDate: date } },
    create: { id: generateId(), accountId, instrumentId, snapshotDate: date, ...data },
    update: data,
  });
}
// Called under the global instrument advisory lock; no account writes and no owner locks.
export async function refreshPriceSnapshots(
  tx: Prisma.TransactionClient,
  instrumentId: string,
  date: Date,
) {
  let cursor: string | undefined;
  for (;;) {
    const accounts = await tx.account.findMany({
      where: {
        ...(cursor ? { id: { gt: cursor } } : {}),
        OR: [
          { investmentTransactions: { some: { instrumentId, deletedAt: null } } },
          { portfolioSnapshots: { some: { instrumentId, snapshotDate: date } } },
        ],
      },
      orderBy: { id: 'asc' },
      take: 100,
      select: { id: true },
    });
    for (const account of accounts) {
      await refreshSnapshot(tx, account.id, instrumentId, date);
      // A backdated price also changes later generated snapshots until superseded.
      let snapshotCursor: string | undefined;
      for (;;) {
        const snapshots = await tx.portfolioDailySnapshot.findMany({
          where: { accountId: account.id, instrumentId, snapshotDate: { gt: date } },
          orderBy: { snapshotDate: 'asc' },
          take: 100,
          ...(snapshotCursor ? { cursor: { id: snapshotCursor }, skip: 1 } : {}),
          select: { id: true, snapshotDate: true },
        });
        for (const snapshot of snapshots)
          await refreshSnapshot(tx, account.id, instrumentId, snapshot.snapshotDate);
        if (snapshots.length < 100) break;
        snapshotCursor = snapshots.at(-1)?.id;
      }
    }
    if (accounts.length < 100) return;
    cursor = accounts.at(-1)?.id;
  }
}
export async function refreshInvestmentSnapshots(
  tx: Prisma.TransactionClient,
  accountId: string,
  instrumentId: string,
  start: Date,
) {
  const day = new Date(start.toISOString().slice(0, 10));
  let cursor: string | undefined;
  for (;;) {
    const prices = await tx.instrumentPrice.findMany({
      where: { instrumentId, priceDate: { gte: day } },
      orderBy: { priceDate: 'asc' },
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, priceDate: true },
    });
    for (const price of prices) await refreshSnapshot(tx, accountId, instrumentId, price.priceDate);
    if (prices.length < 100) break;
    cursor = prices.at(-1)?.id;
  }
  cursor = undefined;
  for (;;) {
    const snapshots: { id: string; snapshotDate: Date }[] =
      await tx.portfolioDailySnapshot.findMany({
        where: { accountId, instrumentId, snapshotDate: { gte: day } },
        orderBy: { snapshotDate: 'asc' },
        take: 100,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, snapshotDate: true },
      });
    for (const snapshot of snapshots)
      await refreshSnapshot(tx, accountId, instrumentId, snapshot.snapshotDate);
    if (snapshots.length < 100) return;
    cursor = snapshots.at(-1)?.id;
  }
}
