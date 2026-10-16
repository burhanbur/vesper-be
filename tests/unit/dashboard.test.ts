import { describe, expect, it, vi } from 'vitest';
import { accessibleAccount } from '../../src/common/authorization/account-access.js';
import { Prisma, type PrismaClient } from '../../src/generated/prisma/client.js';
import { PrismaDashboardRepository } from '../../src/modules/dashboard/dashboard.repository.js';
import {
  DashboardSummaryQuerySchema,
  dashboardPeriodBounds,
} from '../../src/modules/dashboard/dashboard.schema.js';
import { DashboardService } from '../../src/modules/dashboard/dashboard.service.js';

describe('dashboard calendar', () => {
  it.each([
    ['daily', '2024-02-29', '2024-02-28T17:00:00.000Z', '2024-02-29T17:00:00.000Z'],
    ['daily', '2026-12-31', '2026-12-30T17:00:00.000Z', '2026-12-31T17:00:00.000Z'],
    ['monthly', '2024-02', '2024-01-31T17:00:00.000Z', '2024-02-29T17:00:00.000Z'],
    ['monthly', '2026-12', '2026-11-30T17:00:00.000Z', '2026-12-31T17:00:00.000Z'],
    ['yearly', '1000', '0999-12-31T17:00:00.000Z', '1000-12-31T17:00:00.000Z'],
    ['yearly', '9998', '9997-12-31T17:00:00.000Z', '9998-12-31T17:00:00.000Z'],
  ])('calculates %s %s in fixed WIB', (period, value, start, end) => {
    const bounds = dashboardPeriodBounds(DashboardSummaryQuerySchema.parse({ period, value }));
    expect(bounds.start.toISOString()).toBe(start);
    expect(bounds.end.toISOString()).toBe(end);
  });

  it.each([
    ['daily', '2024-02-28', '2024-03-01', '2024-02-27T17:00:00.000Z', '2024-03-01T17:00:00.000Z'],
    ['monthly', '2026-10', '2027-02', '2026-09-30T17:00:00.000Z', '2027-02-28T17:00:00.000Z'],
    ['yearly', '2024', '2026', '2023-12-31T17:00:00.000Z', '2026-12-31T17:00:00.000Z'],
    ['daily', '2026-12-31', '2026-12-31', '2026-12-30T17:00:00.000Z', '2026-12-31T17:00:00.000Z'],
    ['yearly', '1000', '9998', '0999-12-31T17:00:00.000Z', '9998-12-31T17:00:00.000Z'],
  ])('includes the full %s ending period %s through %s', (period, value, end_value, start, end) => {
    const bounds = dashboardPeriodBounds(
      DashboardSummaryQuerySchema.parse({ period, value, end_value }),
    );
    expect(bounds.start.toISOString()).toBe(start);
    expect(bounds.end.toISOString()).toBe(end);
  });

  it.each([
    { period: 'daily', value: '2024-02-01', end_value: '2023-02-29' },
    { period: 'daily', value: '2026-04-01', end_value: '2026-04-31' },
    { period: 'daily', value: '2026-10-01', end_value: '2026-10' },
    { period: 'monthly', value: '2026-10', end_value: '2026-13' },
    { period: 'monthly', value: '2026-10', end_value: '2026-11-01' },
    { period: 'yearly', value: '2026', end_value: '9999' },
    { period: 'yearly', value: '1000', end_value: '0999' },
    { period: 'yearly', value: '2026', end_value: '' },
    { period: 'yearly', value: '2026', end_value: ['2026', '2027'] },
    { period: 'daily', value: '2026-10-02', end_value: '2026-10-01' },
    { period: 'monthly', value: '2026-10', end_value: '2026-09' },
    { period: 'yearly', value: '2026', end_value: '2025' },
  ])('rejects invalid ending period %j before repository access', async (query) => {
    const parsed = DashboardSummaryQuerySchema.safeParse(query);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.path).toEqual(['end_value']);
    const summarize = vi.fn();
    await expect(
      new DashboardService({ summarize }).summary('user', {
        period: 'daily',
        value: '2026-10-02',
        end_value: '2026-10-01',
      }),
    ).rejects.toThrow();
    expect(summarize).not.toHaveBeenCalled();
  });

  it.each([
    { period: 'daily', value: '2023-02-29' },
    { period: 'daily', value: '1900-02-29' },
    { period: 'daily', value: '2026-04-31' },
    { period: 'daily', value: '2026-00-01' },
    { period: 'daily', value: '2026-01-00' },
    { period: 'daily', value: '2026-1-01' },
    { period: 'monthly', value: '2026-13' },
    { period: 'monthly', value: '2026-10-01' },
    { period: 'yearly', value: '0999' },
    { period: 'yearly', value: '9999' },
    { period: 'yearly', value: '2026 ' },
    { period: 'DAILY', value: '2026-10-01' },
    { period: 'yearly', value: ['2026', '2027'] },
    { period: 'yearly', value: '2026', extra: 'ignored' },
    { period: 'yearly' },
    { value: '2026' },
  ])('rejects invalid query %j', (query) => {
    expect(DashboardSummaryQuerySchema.safeParse(query).success).toBe(false);
  });

  it('accepts Gregorian century leap dates and rejects invalid input before repository calls', async () => {
    expect(
      DashboardSummaryQuerySchema.safeParse({ period: 'daily', value: '2000-02-29' }).success,
    ).toBe(true);
    const summarize = vi.fn();
    await expect(
      new DashboardService({ summarize }).summary('user', { period: 'daily', value: '2026-02-30' }),
    ).rejects.toThrow();
    expect(summarize).not.toHaveBeenCalled();
  });
});

describe('dashboard repository and service', () => {
  it('aggregates only accessible non-transfer live rows in one snapshot and preserves decimal precision', async () => {
    const aggregate = vi
      .fn()
      .mockResolvedValueOnce({ _sum: { amount: new Prisma.Decimal('999999999999999999.99') } })
      .mockResolvedValueOnce({ _sum: { amount: new Prisma.Decimal('0.01') } });
    const transaction = vi.fn(async (queries: Promise<unknown>[]) => Promise.all(queries));
    // Minimal fake implements exactly the Prisma methods exercised by this repository.
    const client = {
      transaction: { aggregate },
      $transaction: transaction,
    } as unknown as PrismaClient;
    const service = new DashboardService(new PrismaDashboardRepository(client));
    const result = await service.summary('user-id', { period: 'monthly', value: '2026-10' });
    const where = {
      deletedAt: null,
      transferId: null,
      account: accessibleAccount('user-id'),
      transactedAt: { gte: new Date(result.start_at), lt: new Date(result.end_at) },
    };
    expect(aggregate).toHaveBeenNthCalledWith(1, {
      where: { ...where, type: 'INCOME' },
      _sum: { amount: true },
    });
    expect(aggregate).toHaveBeenNthCalledWith(2, {
      where: { ...where, type: 'EXPENSE' },
      _sum: { amount: true },
    });
    expect(transaction).toHaveBeenCalledExactlyOnceWith(expect.any(Array), {
      isolationLevel: 'RepeatableRead',
    });
    expect(result).toEqual({
      period: 'monthly',
      value: '2026-10',
      end_value: '2026-10',
      timezone: 'Asia/Jakarta',
      start_at: '2026-09-30T17:00:00.000Z',
      end_at: '2026-10-31T17:00:00.000Z',
      income_total: '999999999999999999.99',
      expense_total: '0.01',
      net_cashflow: '999999999999999999.98',
    });
  });

  it('returns zero for empty sums and allows negative net cashflow', async () => {
    const aggregate = vi.fn().mockResolvedValue({ _sum: { amount: null } });
    const client = {
      transaction: { aggregate },
      $transaction: async (queries: Promise<unknown>[]) => Promise.all(queries),
    } as unknown as PrismaClient;
    const repository = new PrismaDashboardRepository(client);
    const query = { period: 'yearly', value: '2026' } as const;
    expect(await new DashboardService(repository).summary('user', query)).toMatchObject({
      income_total: '0.00',
      expense_total: '0.00',
      net_cashflow: '0.00',
    });
    expect(
      await new DashboardService({
        summarize: async () => ({
          income: new Prisma.Decimal('0.10'),
          expense: new Prisma.Decimal('0.30'),
        }),
      }).summary('user', query),
    ).toMatchObject({ net_cashflow: '-0.20' });
  });
});
