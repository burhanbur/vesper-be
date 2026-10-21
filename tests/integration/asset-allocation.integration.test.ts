import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { integrationDatabaseUrl } from '../../src/config/integration-test.js';
import { generateId } from '../../src/common/utils/id.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { PrismaNetWorthRepository } from '../../src/modules/net-worth/net-worth.repository.js';
import { AssetAllocationService } from '../../src/modules/asset-allocation/asset-allocation.service.js';
const client = new PrismaClient({
  adapter: new PrismaPg({ connectionString: integrationDatabaseUrl() }),
});
const at = new Date('2026-10-21T12:00:00.000Z');
const service = new AssetAllocationService(new PrismaNetWorthRepository(client), () => at);
beforeAll(async () => {
  expect(
    await client.$queryRaw`SELECT current_database() AS database, current_user AS username`,
  ).toEqual([{ database: 'vesper_integration_test', username: 'vesper_integration' }]);
});
afterAll(async () => {
  await client.$disconnect();
});
async function fixture() {
  const user = generateId(),
    cashType = generateId(),
    investType = generateId();
  await client.user.create({
    data: {
      id: user,
      name: 'Allocation test',
      email: `${user}@example.invalid`,
      passwordHash: 'unused',
    },
  });
  await client.accountType.createMany({
    data: [
      { id: cashType, userId: user, name: 'Cash', category: 'CASH' },
      { id: investType, userId: user, name: 'Investments', category: 'INVESTMENT' },
    ],
  });
  async function account(name: string, balance: string, investment = false) {
    const row = await client.account.create({
      data: {
        id: generateId(),
        userId: user,
        accountTypeId: investment ? investType : cashType,
        name,
        balance,
      },
    });
    return row.id;
  }
  const cash = await account('Cash', '100'),
    a = await account('A', '10', true),
    b = await account('B', '0', true);
  const instrument = generateId();
  await client.instrument.create({
    data: {
      id: instrument,
      code: instrument.toUpperCase(),
      name: 'Gold',
      type: 'GOLD',
      currency: 'IDR',
    },
  });
  await client.investmentTransaction.createMany({
    data: [a, b].map((accountId, index) => ({
      id: generateId(),
      accountId,
      instrumentId: instrument,
      type: 'BUY',
      quantity: String(index + 1),
      pricePerUnit: '50',
      fee: '0',
      transactedAt: new Date('2026-10-20T01:00:00.000Z'),
      createdBy: user,
      updatedBy: user,
    })),
  });
  return { user, cash, a, b, instrument, account };
}
describe('allocation coherent owner scope on isolated PostgreSQL', () => {
  it('consolidates cash, positions and receivables once; excludes foreign/shared/parent/opt-out assets and liabilities', async () => {
    const f = await fixture(),
      other = await fixture();
    await client.instrumentPrice.create({
      data: {
        id: generateId(),
        instrumentId: f.instrument,
        priceDate: new Date('2026-10-20'),
        closePrice: '50',
        updatedBy: f.user,
      },
    });
    const parent = await f.account('Parent', '99999');
    await client.account.update({ where: { id: f.cash }, data: { parentAccountId: parent } });
    const excluded = await f.account('Excluded', '99999');
    await client.account.update({ where: { id: excluded }, data: { isIncludeTotal: false } });
    await f.account('Overdraft', '-20');
    const mapped = await f.account('Mapped payable', '-50');
    await client.obligation.createMany({
      data: [
        {
          id: generateId(),
          userId: f.user,
          kind: 'PAYABLE',
          counterparty: 'Test',
          currency: 'IDR',
          principal: '50',
          outstanding: '50',
          installments: [],
          linkedAccountId: mapped,
        },
        {
          id: generateId(),
          userId: f.user,
          kind: 'RECEIVABLE',
          counterparty: 'Test',
          currency: 'IDR',
          principal: '40',
          outstanding: '40',
          installments: [],
        },
      ],
    });
    const group = generateId();
    await client.group.create({
      data: {
        id: group,
        code: group.replaceAll('-', '').slice(0, 12).toUpperCase(),
        name: 'Test household',
        createdBy: other.user,
        updatedBy: other.user,
      },
    });
    await client.userGroup.createMany({
      data: [f.user, other.user].map((userId) => ({
        id: generateId(),
        groupId: group,
        userId,
        role: 'MEMBER',
        createdBy: other.user,
      })),
    });
    await client.groupAccount.create({
      data: { id: generateId(), groupId: group, accountId: other.cash },
    });
    const before = await client.account.findMany({
      where: { userId: f.user },
      orderBy: { id: 'asc' },
    });
    const r = await service.snapshot(f.user);
    expect(r).toMatchObject({
      status: 'complete',
      total_assets: '300.00',
      excluded_liabilities: '70.00',
      excluded_account_count: 2,
    });
    expect(r.instruments).toHaveLength(1);
    expect(r.instruments[0]).toMatchObject({
      instrument_id: f.instrument,
      asset_class: 'GOLD',
      market_value: '150.00',
      account_count: 2,
      weight_percent: '50.00',
      stale: true,
    });
    expect(r.classes.find((c) => c.asset_class === 'CASH')!.market_value).toBe('110.00');
    expect(r.classes.find((c) => c.asset_class === 'RECEIVABLE')!.market_value).toBe('40.00');
    expect(
      await client.account.findMany({ where: { userId: f.user }, orderBy: { id: 'asc' } }),
    ).toEqual(before);
    expect(await client.netWorthObservation.count({ where: { userId: f.user } })).toBe(0);
    expect(await client.syncChange.count({ where: { userId: f.user } })).toBe(0);
    expect(await client.transaction.count({ where: { createdBy: f.user } })).toBe(0);
  });
  it('does not use future quotes or turn missing positions into zero; a dated quote restores explicit weights', async () => {
    const f = await fixture();
    const future = await client.instrumentPrice.create({
      data: {
        id: generateId(),
        instrumentId: f.instrument,
        priceDate: new Date('2026-10-22'),
        closePrice: '999',
        updatedBy: f.user,
      },
    });
    const r = await service.snapshot(f.user);
    expect(r).toMatchObject({ status: 'partial', known_assets: '110.00', total_assets: null });
    expect(r.instruments[0]).toMatchObject({
      market_value: null,
      weight_percent: null,
      price_date: null,
    });
    expect(r.classes.every((c) => c.weight_percent === null)).toBe(true);
    await client.instrumentPrice.update({
      where: { id: future.id },
      data: { priceDate: new Date('2026-10-21'), closePrice: '50' },
    });
    const updated = await service.snapshot(f.user);
    expect(updated).toMatchObject({ status: 'complete', total_assets: '260.00' });
    expect(updated.instruments[0]).toMatchObject({
      market_value: '150.00',
      stale: false,
      price_source: 'MANUAL',
    });
  });
});
