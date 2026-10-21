import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../src/generated/prisma/client.js';
import { generateId } from '../../src/common/utils/id.js';
import type { NetWorthSource } from '../../src/modules/net-worth/net-worth.repository.js';
import {
  consolidateAllocation,
  AssetAllocationService,
} from '../../src/modules/asset-allocation/asset-allocation.service.js';

const at = new Date('2026-10-21T10:00:00.000Z');
const decimal = (v: string) => new Prisma.Decimal(v);
function fixture(): NetWorthSource {
  const id = generateId();
  return {
    accounts: [
      {
        id: 'cash',
        balance: decimal('100'),
        isIncludeTotal: true,
        children: [],
        accountType: { category: 'CASH' },
      },
      {
        id: 'a',
        balance: decimal('10'),
        isIncludeTotal: true,
        children: [],
        accountType: { category: 'INVESTMENT' },
      },
      {
        id: 'b',
        balance: decimal('0'),
        isIncludeTotal: true,
        children: [],
        accountType: { category: 'INVESTMENT' },
      },
      {
        id: 'negative',
        balance: decimal('-20'),
        isIncludeTotal: true,
        children: [],
        accountType: { category: 'CASH' },
      },
      {
        id: 'parent',
        balance: decimal('9999'),
        isIncludeTotal: true,
        children: [{ id: 'cash' }],
        accountType: { category: 'CASH' },
      },
    ],
    positions: ['a', 'b'].map((accountId) => ({
      accountId,
      instrumentId: id,
      type: 'BUY',
      _sum: { quantity: decimal('1') },
    })),
    instruments: [
      {
        id,
        code: 'GOLD',
        name: 'Gold',
        type: 'GOLD',
        currency: 'IDR',
        deletedAt: null,
        prices: [
          { closePrice: decimal('50'), priceDate: new Date('2026-10-20'), source: 'MANUAL' },
        ],
      },
    ],
    obligations: [],
  };
}
describe('gross asset allocation', () => {
  it('aggregates instruments across accounts, settlement cash once and excludes liabilities/parents', () => {
    const r = consolidateAllocation(fixture(), at);
    expect(r).toMatchObject({
      status: 'complete',
      known_assets: '210.00',
      total_assets: '210.00',
      excluded_liabilities: '20.00',
      excluded_account_count: 1,
    });
    expect(r.classes.find((c) => c.asset_class === 'CASH')).toMatchObject({
      market_value: '110.00',
      weight_percent: '52.38',
    });
    expect(r.classes.find((c) => c.asset_class === 'GOLD')).toMatchObject({
      market_value: '100.00',
      weight_percent: '47.61',
    });
    expect(r.instruments).toHaveLength(1);
    expect(r.instruments[0]).toMatchObject({
      quantity: '2.00000000',
      account_count: 2,
      market_value: '100.00',
      weight_percent: '47.61',
      stale: true,
      price_source: 'MANUAL',
    });
  });
  it('missing price keeps unknown values null and withholds every percentage', () => {
    const s = fixture();
    s.instruments[0]!.prices = [];
    const r = consolidateAllocation(s, at);
    expect(r).toMatchObject({ status: 'partial', known_assets: '110.00', total_assets: null });
    expect(r.classes.every((c) => c.weight_percent === null)).toBe(true);
    expect(r.instruments[0]).toMatchObject({
      market_value: null,
      known_amount: '0.00',
      weight_percent: null,
      unavailable_reasons: ['price_missing'],
    });
  });
  it('unknown class retains known monetary value without fabricating a supported classification', () => {
    const s = fixture();
    delete s.instruments[0]!.type;
    const r = consolidateAllocation(s, at);
    expect(r).toMatchObject({ status: 'partial', known_assets: '210.00', total_assets: null });
    expect(r.classes.find((c) => c.asset_class === 'UNCLASSIFIED')).toMatchObject({
      known_amount: '100.00',
      weight_percent: null,
    });
    expect(r.instruments[0]!.unavailable_reasons).toContain('instrument_class_unavailable');
  });
  it('rounds each position before consolidation and truncates positive weights exactly', () => {
    const s = fixture();
    s.instruments[0]!.prices[0]!.closePrice = decimal('0.005');
    s.accounts[0]!.balance = decimal('9007199254740993.01');
    const r = consolidateAllocation(s, at);
    expect(r.instruments[0]!.market_value).toBe('0.02');
    expect(r.known_assets).toBe('9007199254741003.03');
    expect(r.classes.find((c) => c.asset_class === 'CASH')!.weight_percent).toBe('99.99');
  });
  it('zero gross assets and legacy incomplete obligation adapters have no implied 100 percent', () => {
    const empty: NetWorthSource = { accounts: [], instruments: [], positions: [], obligations: [] };
    const r = consolidateAllocation(empty, at);
    expect(r).toMatchObject({ status: 'complete', total_assets: '0.00' });
    expect(r.classes.every((c) => c.weight_percent === null)).toBe(true);
    delete empty.obligations;
    expect(consolidateAllocation(empty, at).status).toBe('partial');
  });
  it('invalid short positions remain unknown rather than negative asset weights', () => {
    const s = fixture();
    s.positions[0]!.type = 'SELL';
    const r = consolidateAllocation(s, at);
    expect(r.status).toBe('partial');
    expect(r.instruments[0]).toMatchObject({
      known_amount: '50.00',
      market_value: null,
      weight_percent: null,
    });
    expect(r.instruments[0]!.unavailable_reasons).toContain('invalid_position');
  });
  it('uses one owner/date read and never captures history or invokes mutation adapters', async () => {
    const repository = {
      read: vi.fn().mockResolvedValue(fixture()),
      findCapture: vi.fn(),
      capture: vi.fn(),
    };
    await new AssetAllocationService(repository, () => at).snapshot('owner');
    expect(repository.read).toHaveBeenCalledExactlyOnceWith('owner', 'IDR', '2026-10-21');
    expect(repository.capture).not.toHaveBeenCalled();
    expect(repository.findCapture).not.toHaveBeenCalled();
  });
});
