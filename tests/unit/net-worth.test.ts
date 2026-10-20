import { describe, expect, it, vi } from 'vitest';
import { Prisma, type PrismaClient } from '../../src/generated/prisma/client.js';
import {
  PrismaNetWorthRepository,
  netWorthOwnerFilter,
  type NetWorthSource,
} from '../../src/modules/net-worth/net-worth.repository.js';
import {
  consolidateNetWorth,
  NetWorthService,
} from '../../src/modules/net-worth/net-worth.service.js';
import { NetWorthQuerySchema } from '../../src/modules/net-worth/net-worth.schema.js';

const now = new Date('2026-10-20T12:00:00Z');
const decimal = (value: string) => new Prisma.Decimal(value);
function account(
  id: string,
  balance: string,
  category: 'CASH' | 'INVESTMENT' = 'CASH',
  included = true,
  children: { id: string }[] = [],
) {
  return {
    id,
    balance: decimal(balance),
    accountType: { category },
    isIncludeTotal: included,
    children,
  };
}
function source(): NetWorthSource {
  return {
    accounts: [account('cash', '800'), account('investment', '10', 'INVESTMENT')],
    positions: [
      {
        accountId: 'investment',
        instrumentId: 'instrument',
        type: 'BUY',
        _sum: { quantity: decimal('2') },
      },
    ],
    instruments: [
      {
        id: 'instrument',
        currency: 'IDR',
        deletedAt: null,
        prices: [
          { closePrice: decimal('100'), priceDate: new Date('2026-10-19'), source: 'MANUAL' },
        ],
      },
    ],
  };
}
const snapshot = (data: NetWorthSource) => consolidateNetWorth(data, 'IDR', '2026-10-20', now);

describe('owner net worth', () => {
  it('adds settlement cash and holdings once, excludes parents and opted-out leaves', () => {
    const data = source();
    data.accounts.push(
      account('parent', '9999', 'CASH', true, [{ id: 'cash' }]),
      account('excluded', '9999', 'CASH', false),
    );
    data.positions.push({
      accountId: 'excluded',
      instrumentId: 'instrument',
      type: 'BUY',
      _sum: { quantity: decimal('99') },
    });
    expect(snapshot(data)).toMatchObject({
      known_net_worth: '1010.00',
      cash_balance: '800.00',
      investment_cash_balance: '10.00',
      holdings_value: '200.00',
      excluded_account_count: 2,
      status: 'partial',
      net_worth: null,
      attribution: 'unavailable',
      holdings: [{ price_date: '2026-10-19', stale: true }],
    });
  });
  it('preserves totals under internal transfers and buy/sell settlement (fees reduce worth)', () => {
    const before = snapshot(source());
    const moved = source();
    moved.accounts[0] = account('cash', '700');
    moved.accounts.push(account('pocket', '100'));
    expect(snapshot(moved).known_net_worth).toBe(before.known_net_worth);
    const bought = source();
    bought.accounts[0] = account('cash', '699');
    bought.positions[0] = {
      accountId: 'investment',
      instrumentId: 'instrument',
      type: 'BUY',
      _sum: { quantity: decimal('3') },
    };
    expect(snapshot(bought).known_net_worth).toBe('1009.00');
    bought.positions.push({
      accountId: 'investment',
      instrumentId: 'instrument',
      type: 'SELL',
      _sum: { quantity: decimal('1') },
    });
    bought.accounts[0] = account('cash', '798');
    expect(snapshot(bought).known_net_worth).toBe('1008.00');
  });
  it('keeps missing valuation unknown and exposes only a known subtotal', () => {
    const data = source();
    data.instruments[0]?.prices.splice(0);
    expect(snapshot(data)).toMatchObject({
      holdings_value: null,
      known_net_worth: '810.00',
      net_worth: null,
      holdings: [
        { market_value: null, price: null, stale: null, unavailable_reason: 'price_missing' },
      ],
      missing_components: [
        'liabilities_unmodeled',
        'receivables_unmodeled',
        'attribution_unavailable',
        'holdings_valuation_incomplete',
      ],
    });
  });
  it('never combines instrument currencies or values deleted instruments', () => {
    const data = source();
    const instrument = data.instruments[0];
    if (!instrument) throw new Error('fixture');
    instrument.currency = 'USD';
    expect(snapshot(data).holdings[0]?.unavailable_reason).toBe('currency_mismatch');
    instrument.deletedAt = now;
    expect(snapshot(data).holdings[0]?.unavailable_reason).toBe('instrument_unavailable');
  });
  it('uses exact large sums and classifies negative ledger balances without pretending debt completeness', () => {
    const data: NetWorthSource = {
      accounts: [
        account('a', '999999999999999999.99'),
        account('b', '0.02'),
        account('c', '-0.01'),
      ],
      positions: [],
      instruments: [],
    };
    expect(snapshot(data)).toMatchObject({
      known_assets: '1000000000000000000.01',
      known_balance_liabilities: '0.01',
      known_net_worth: '1000000000000000000.00',
      net_worth: null,
    });
  });
  it('rounds each position half-up and treats a closed position as known zero without prices', () => {
    const data = source();
    const price = data.instruments[0]?.prices[0];
    if (!price) throw new Error('fixture');
    price.closePrice = decimal('0.0025');
    price.priceDate = new Date('2026-10-20');
    expect(snapshot(data)).toMatchObject({ holdings_value: '0.01', holdings: [{ stale: false }] });
    data.positions.push({
      accountId: 'investment',
      instrumentId: 'instrument',
      type: 'SELL',
      _sum: { quantity: decimal('2') },
    });
    data.instruments = [];
    expect(snapshot(data)).toMatchObject({ holdings_value: '0.00', holdings: [] });
  });
  it('does not query or reconstruct past balances and rejects future dates', async () => {
    const read = vi.fn().mockResolvedValue(source());
    const findCapture = vi.fn().mockResolvedValue(null);
    const capture = vi.fn().mockResolvedValue(undefined);
    const service = new NetWorthService({ read, findCapture, capture }, () => now);
    expect(await service.snapshot('owner', { currency: 'IDR', date: '2026-10-19' })).toMatchObject({
      status: 'unavailable',
      known_net_worth: null,
      balance_basis: 'unavailable',
    });
    await expect(
      service.snapshot('owner', { currency: 'IDR', date: '2026-10-21' }),
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(read).not.toHaveBeenCalled();
    await service.snapshot('owner', { currency: 'IDR' });
    expect(read).toHaveBeenCalledWith('owner', 'IDR', '2026-10-20');
    expect(findCapture).toHaveBeenCalledWith('owner', 'IDR', '2026-10-19');
    expect(capture).toHaveBeenCalledWith('owner', snapshot(source()));
  });
  it('returns captured DTO unchanged without recomputing or recapturing history', async () => {
    const captured = { ...snapshot(source()), balance_basis: 'captured_recorded_ledger' as const };
    const repository = {
      read: vi.fn(),
      capture: vi.fn(),
      findCapture: vi.fn().mockResolvedValue(captured),
    };
    const service = new NetWorthService(repository, () => new Date('2026-10-21T12:00:00Z'));
    expect(await service.snapshot('owner', { currency: 'IDR', date: '2026-10-20' })).toEqual(
      captured,
    );
    expect(repository.read).not.toHaveBeenCalled();
    expect(repository.capture).not.toHaveBeenCalled();
  });
  it.each([
    { date: '2026-02-30' },
    { currency: 'idr' },
    { user_id: 'other' },
    { scope: 'shared' },
    { date: ['2026-10-20', '2026-10-19'] },
  ])('rejects invalid or scope-changing query %j', (query) => {
    expect(NetWorthQuerySchema.safeParse(query).success).toBe(false);
  });
  it('filters both account and type ownership (never group-access OR), deleted data and currency in one repeatable read', async () => {
    const findMany = vi.fn().mockResolvedValue(source().accounts);
    const groupBy = vi.fn().mockResolvedValue([]);
    const tx = {
      account: { findMany },
      investmentTransaction: { groupBy },
      instrument: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const transaction = vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
    );
    const client = { $transaction: transaction } as unknown as PrismaClient;
    await new PrismaNetWorthRepository(client).read('owner', 'USD', '2026-10-20');
    expect(findMany.mock.calls[0]?.[0].where).toEqual(netWorthOwnerFilter('owner', 'USD'));
    expect(netWorthOwnerFilter('owner', 'USD')).toEqual({
      userId: 'owner',
      currency: 'USD',
      deletedAt: null,
      accountType: {
        userId: 'owner',
        deletedAt: null,
        user: { status: 'ACTIVE', deletedAt: null },
      },
    });
    expect(groupBy.mock.calls[0]?.[0].where).toEqual({
      accountId: { in: ['cash', 'investment'] },
      deletedAt: null,
      type: { in: ['BUY', 'SELL'] },
    });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
  });
  it.each(['accounts', 'positions'] as const)(
    'rejects oversized %s without returning truncated totals',
    async (scope) => {
      const data = source();
      const tx = {
        account: {
          findMany: vi
            .fn()
            .mockResolvedValue(
              scope === 'accounts'
                ? Array.from({ length: 1001 }, () => account('cash', '1'))
                : data.accounts,
            ),
        },
        investmentTransaction: {
          groupBy: vi
            .fn()
            .mockResolvedValue(
              scope === 'positions' ? Array.from({ length: 10001 }, () => data.positions[0]) : [],
            ),
        },
        instrument: { findMany: vi.fn().mockResolvedValue([]) },
      };
      const transaction = vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      );
      const client = { $transaction: transaction } as unknown as PrismaClient;
      await expect(
        new PrismaNetWorthRepository(client).read('owner', 'IDR', '2026-10-20'),
      ).rejects.toMatchObject({ statusCode: 422, code: 'NET_WORTH_SCOPE_LIMIT' });
      expect(tx.instrument.findMany).not.toHaveBeenCalled();
      if (scope === 'accounts') expect(tx.investmentTransaction.groupBy).not.toHaveBeenCalled();
    },
  );
});
