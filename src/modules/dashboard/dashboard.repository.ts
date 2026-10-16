import { accessibleAccount } from '../../common/authorization/account-access.js';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';

export type DashboardTotals = { income: Prisma.Decimal; expense: Prisma.Decimal };
export interface DashboardRepository {
  summarize(userId: string, start: Date, end: Date): Promise<DashboardTotals>;
}

export class PrismaDashboardRepository implements DashboardRepository {
  constructor(private readonly client: PrismaClient) {}

  async summarize(userId: string, start: Date, end: Date): Promise<DashboardTotals> {
    const where: Prisma.TransactionWhereInput = {
      deletedAt: null,
      transferId: null,
      account: accessibleAccount(userId),
      transactedAt: { gte: start, lt: end },
    };
    const [income, expense] = await this.client.$transaction(
      [
        this.client.transaction.aggregate({
          where: { ...where, type: 'INCOME' },
          _sum: { amount: true },
        }),
        this.client.transaction.aggregate({
          where: { ...where, type: 'EXPENSE' },
          _sum: { amount: true },
        }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return {
      income: income._sum.amount ?? new Prisma.Decimal(0),
      expense: expense._sum.amount ?? new Prisma.Decimal(0),
    };
  }
}
