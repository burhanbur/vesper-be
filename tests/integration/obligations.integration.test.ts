import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { integrationDatabaseUrl } from '../../src/config/integration-test.js';
import { generateId } from '../../src/common/utils/id.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { SyncRepository } from '../../src/modules/sync/sync.repository.js';
import { PushItemSchema } from '../../src/modules/sync/sync.schema.js';
import { PrismaNetWorthRepository } from '../../src/modules/net-worth/net-worth.repository.js';
import { consolidateNetWorth } from '../../src/modules/net-worth/net-worth.service.js';
import { PrismaTransactionRepository } from '../../src/modules/transactions/transaction.repository.js';
import { syncClient } from '../../src/infrastructure/database/sync-publication.js';

const client = new PrismaClient({
  adapter: new PrismaPg({ connectionString: integrationDatabaseUrl() }),
});
const sync = new SyncRepository(client);
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
    cash = generateId(),
    type = generateId(),
    device = generateId(),
    expense = generateId(),
    income = generateId();
  await client.user.create({
    data: {
      id: user,
      name: 'Obligation test',
      email: `${user}@example.invalid`,
      passwordHash: 'unused',
    },
  });
  await client.accountType.create({
    data: { id: type, userId: user, name: 'Cash', category: 'CASH' },
  });
  await client.account.create({
    data: { id: cash, userId: user, accountTypeId: type, name: 'Cash', balance: '1000.00' },
  });
  await client.category.createMany({
    data: [
      { id: expense, userId: user, name: 'Costs', type: 'EXPENSE' },
      { id: income, userId: user, name: 'Interest', type: 'INCOME' },
    ],
  });
  await client.transaction.create({
    data: {
      id: generateId(),
      accountId: cash,
      categoryId: income,
      type: 'INCOME',
      amount: '1000',
      transactedAt: new Date('2026-10-01T00:00:00Z'),
      createdBy: user,
      updatedBy: user,
    },
  });
  await client.device.create({
    data: { id: device, userId: user, platform: 'Android', name: 'Test', appVersion: '1' },
  });
  return { user, cash, type, device, expense, income };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function command(payload: object) {
  return PushItemSchema.parse({
    entity_id: generateId(),
    entity_type: 'obligation_commands',
    operation: 'CREATE',
    client_version: '0',
    payload: {
      obligation_id: generateId(),
      ledger_ids: {
        cash_principal: generateId(),
        mapped_principal: generateId(),
        interest: generateId(),
        fee: generateId(),
      },
      transacted_at: '2026-10-20T10:00:00.000Z',
      ...payload,
    },
  });
}
const opening = (f: Fixture, extra = {}) =>
  command({
    action: 'OPEN',
    kind: 'PAYABLE',
    counterparty: 'Private lender',
    currency: 'IDR',
    principal: '100.00',
    due_date: '2026-12-20',
    installments: [
      { due_date: '2026-11-20', principal: '40.00' },
      { due_date: '2026-12-20', principal: '60.00' },
    ],
    cash_account_id: f.cash,
    linked_account_id: null,
    ...extra,
  });
async function debt(f: Fixture) {
  return client.obligation.findFirstOrThrow({ where: { userId: f.user, deletedAt: null } });
}
async function cash(f: Fixture) {
  return (await client.account.findUniqueOrThrow({ where: { id: f.cash } })).balance.toFixed(2);
}
async function netWorth(f: Fixture) {
  const data = await new PrismaNetWorthRepository(client).read(f.user, 'IDR', '2026-10-20');
  return consolidateNetWorth(data, 'IDR', '2026-10-20', new Date('2026-10-20T10:00:00Z'));
}
async function repayment(f: Fixture, principal: string, interest = '0.00', fee = '0.00') {
  const row = await debt(f);
  return command({
    action: 'REPAY',
    obligation_id: row.id,
    expected_version: row.version.toString(),
    cash_account_id: f.cash,
    principal,
    interest,
    fee,
    interest_category_id: f.expense,
    fee_category_id: f.expense,
  });
}
describe('obligation lifecycle on isolated PostgreSQL', () => {
  it('prevents foreign cancellation and database-level reuse of reserved ledger UUIDs', async () => {
    const f = await fixture(),
      foreign = await fixture();
    const item = opening(f);
    if (item.entity_type !== 'obligation_commands') throw new Error('Invalid fixture');
    const cancellation = PushItemSchema.parse({ ...item, entity_type: 'obligation_cancellations' });
    await expect(sync.apply(foreign.user, foreign.device, cancellation)).rejects.toThrow();
    expect(await client.obligationEvent.findUnique({ where: { id: item.entity_id } })).toBeNull();
    await sync.apply(f.user, f.device, cancellation);
    await expect(
      client.transaction.create({
        data: {
          id: item.payload.ledger_ids.cash_principal,
          accountId: f.cash,
          categoryId: f.income,
          type: 'INCOME',
          amount: '1',
          transactedAt: new Date(),
          createdBy: f.user,
          updatedBy: f.user,
        },
      }),
    ).rejects.toThrow();
    expect(await cash(f)).toBe('1000.00');
    expect(await client.obligation.count({ where: { userId: f.user } })).toBe(0);
  });
  it('rejects partial deletion and cash overflow without committing an event or balance', async () => {
    const f = await fixture();
    await sync.apply(f.user, f.device, opening(f));
    await sync.apply(f.user, f.device, await repayment(f, '40.00'));
    const row = await debt(f);
    await expect(
      sync.apply(
        f.user,
        f.device,
        command({
          action: 'DELETE',
          obligation_id: row.id,
          expected_version: row.version.toString(),
        }),
      ),
    ).rejects.toThrow();
    expect(await cash(f)).toBe('1060.00');
    const limit = await fixture();
    await expect(
      sync.apply(
        limit.user,
        limit.device,
        opening(limit, { principal: '999999999999999999.99', installments: [], due_date: null }),
      ),
    ).rejects.toThrow();
    expect(await cash(limit)).toBe('1000.00');
    expect(await client.obligation.count({ where: { userId: limit.user } })).toBe(0);
  });
  it('funds once across simultaneous devices; principal is not income and net worth is unchanged', async () => {
    const f = await fixture(),
      item = opening(f);
    await Promise.all([sync.apply(f.user, f.device, item), sync.apply(f.user, f.device, item)]);
    expect(await cash(f)).toBe('1100.00');
    expect((await debt(f)).outstanding.toFixed(2)).toBe('100.00');
    expect(await client.obligationEvent.count({ where: { userId: f.user } })).toBe(1);
    const assessed = await netWorth(f);
    expect(assessed.net_worth).toBe('1000.00');
    expect(assessed.obligation_liabilities).toBe('100.00');
    expect(assessed.cash_balance).toBe('1100.00');
    const leg = await client.transaction.findFirstOrThrow({
      where: { obligationEventId: item.entity_id },
    });
    expect(leg.type).toBe('TRANSFER');
    expect(leg.amount.toFixed(2)).toBe('100.00');
  });
  it('pays partial principal, interest and fee separately; reverses all cash and audit effects atomically', async () => {
    const f = await fixture();
    await sync.apply(f.user, f.device, opening(f));
    const pay = await repayment(f, '40.00', '2.00', '1.00');
    await sync.apply(f.user, f.device, pay);
    expect(await cash(f)).toBe('1057.00');
    expect((await debt(f)).outstanding.toFixed(2)).toBe('60.00');
    expect((await netWorth(f)).net_worth).toBe('997.00');
    const cost = await client.transaction.findFirstOrThrow({
      where: { obligationEventId: pay.entity_id, type: 'EXPENSE' },
    });
    await expect(
      new PrismaTransactionRepository(syncClient(client)).softDelete(f.user, cost.id, cost.version),
    ).rejects.toThrow();
    const legs = await client.transaction.findMany({ where: { obligationEventId: pay.entity_id } });
    expect(legs.map((r) => [r.type, r.amount.toFixed(2)]).sort()).toEqual([
      ['EXPENSE', '1.00'],
      ['EXPENSE', '2.00'],
      ['TRANSFER', '-40.00'],
    ]);
    const row = await debt(f);
    const other = await fixture();
    await expect(
      sync.apply(
        f.user,
        f.device,
        command({
          action: 'REPAY',
          obligation_id: row.id,
          expected_version: row.version.toString(),
          cash_account_id: f.cash,
          principal: '1.00',
          interest: '1.00',
          fee: '0.00',
          interest_category_id: other.expense,
          fee_category_id: null,
        }),
      ),
    ).rejects.toThrow();
    const reverse = command({
      action: 'REVERSE',
      obligation_id: row.id,
      expected_version: row.version.toString(),
      target_event_id: pay.entity_id,
    });
    await sync.apply(f.user, f.device, reverse);
    await sync.apply(f.user, f.device, reverse);
    expect(await cash(f)).toBe('1100.00');
    expect((await debt(f)).outstanding.toFixed(2)).toBe('100.00');
    expect(
      await client.transaction.count({
        where: { obligationEventId: pay.entity_id, deletedAt: null },
      }),
    ).toBe(0);
    expect(
      (await client.obligationEvent.findUniqueOrThrow({ where: { id: pay.entity_id } })).reversedAt,
    ).not.toBeNull();
  });
  it('settles receivable principal and interest without double-counting the asset', async () => {
    const f = await fixture();
    await sync.apply(f.user, f.device, opening(f, { kind: 'RECEIVABLE' }));
    expect(await cash(f)).toBe('900.00');
    expect((await netWorth(f)).net_worth).toBe('1000.00');
    const row = await debt(f);
    await sync.apply(
      f.user,
      f.device,
      command({
        action: 'REPAY',
        obligation_id: row.id,
        expected_version: '1',
        cash_account_id: f.cash,
        principal: '100.00',
        interest: '3.00',
        fee: '1.00',
        interest_category_id: f.income,
        fee_category_id: f.expense,
      }),
    );
    expect(await cash(f)).toBe('1002.00');
    expect((await debt(f)).outstanding.toFixed(2)).toBe('0.00');
    expect((await netWorth(f)).receivables_value).toBe('0.00');
    expect((await netWorth(f)).net_worth).toBe('1002.00');
  });
  it('maps an existing negative account once and updates both legacy and cash balances', async () => {
    const f = await fixture(),
      legacy = generateId();
    await client.account.create({
      data: {
        id: legacy,
        userId: f.user,
        accountTypeId: f.type,
        name: 'Legacy card',
        balance: '-100',
      },
    });
    await client.transaction.create({
      data: {
        id: generateId(),
        accountId: legacy,
        categoryId: f.expense,
        type: 'EXPENSE',
        amount: '100',
        transactedAt: new Date(),
        createdBy: f.user,
        updatedBy: f.user,
      },
    });
    expect((await netWorth(f)).net_worth).toBe('900.00');
    await sync.apply(
      f.user,
      f.device,
      opening(f, { cash_account_id: null, linked_account_id: legacy }),
    );
    expect((await netWorth(f)).net_worth).toBe('900.00');
    await expect(
      sync.apply(
        f.user,
        f.device,
        opening(f, { cash_account_id: null, linked_account_id: legacy }),
      ),
    ).rejects.toThrow();
    await sync.apply(f.user, f.device, await repayment(f, '40.00'));
    expect(await cash(f)).toBe('960.00');
    expect(
      (await client.account.findUniqueOrThrow({ where: { id: legacy } })).balance.toFixed(2),
    ).toBe('-60.00');
    expect((await netWorth(f)).net_worth).toBe('900.00');
  });
  it('archives a fully paid record without changing cash; voiding untouched funding reverses opening cash', async () => {
    const f = await fixture();
    const open = opening(f);
    await sync.apply(f.user, f.device, open);
    let row = await debt(f);
    const remove = command({ action: 'DELETE', obligation_id: row.id, expected_version: '1' });
    await sync.apply(f.user, f.device, remove);
    expect(await cash(f)).toBe('1000.00');
    expect(await client.obligation.count({ where: { userId: f.user, deletedAt: null } })).toBe(0);
    await sync.apply(f.user, f.device, open); // Old accepted command remains a replay, never new funding.
    expect(await cash(f)).toBe('1000.00');
    await sync.apply(f.user, f.device, opening(f));
    await sync.apply(f.user, f.device, await repayment(f, '100.00'));
    row = await debt(f);
    await sync.apply(
      f.user,
      f.device,
      command({
        action: 'DELETE',
        obligation_id: row.id,
        expected_version: row.version.toString(),
      }),
    );
    expect(await cash(f)).toBe('1000.00');
  });
  it('rejects overspending principal, stale concurrent versions, foreign accounts and categories without partial writes', async () => {
    const f = await fixture(),
      other = await fixture();
    await sync.apply(f.user, f.device, opening(f));
    await expect(sync.apply(f.user, f.device, await repayment(f, '101.00'))).rejects.toThrow();
    const first = await repayment(f, '60.00'),
      second = await repayment(f, '60.00');
    const results = await Promise.allSettled([
      sync.apply(f.user, f.device, first),
      sync.apply(f.user, f.device, second),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await cash(f)).toBe('1040.00');
    const row = await debt(f);
    await expect(
      sync.apply(
        f.user,
        f.device,
        command({
          action: 'REPAY',
          obligation_id: row.id,
          expected_version: row.version.toString(),
          cash_account_id: other.cash,
          principal: '1.00',
          interest: '0.00',
          fee: '0.00',
          interest_category_id: null,
          fee_category_id: null,
        }),
      ),
    ).rejects.toThrow();
    expect(await cash(f)).toBe('1040.00');
    await expect(
      sync.apply(other.user, other.device, await repayment(f, '1.00')),
    ).rejects.toThrow();
  });
  it('reserves cancelled UUID commands, publishes tombstones, and resolves already-applied cancellation safely', async () => {
    const f = await fixture(),
      item = opening(f);
    const cancelled = PushItemSchema.parse({ ...item, entity_type: 'obligation_cancellations' });
    expect((await sync.apply(f.user, f.device, cancelled)).server_data).toMatchObject({
      cancelled: true,
    });
    await sync.apply(f.user, f.device, cancelled);
    await expect(sync.apply(f.user, f.device, item)).rejects.toThrow();
    expect(await cash(f)).toBe('1000.00');
    const page = await sync.pull(f.user, { device_id: f.device, since_version: '0', limit: 100 });
    expect(
      page.changes.some((r) => r.entity_type === 'obligations' && r.operation === 'DELETE'),
    ).toBe(true);
    const accepted = opening(f);
    await sync.apply(f.user, f.device, accepted);
    expect(
      (
        await sync.apply(
          f.user,
          f.device,
          PushItemSchema.parse({ ...accepted, entity_type: 'obligation_cancellations' }),
        )
      ).server_data,
    ).toMatchObject({ cancelled: false });
    expect(await cash(f)).toBe('1100.00');
  });
  it('keeps obligations private even when the settlement cash account is shared', async () => {
    const f = await fixture(),
      member = await fixture(),
      group = generateId();
    await client.group.create({
      data: {
        id: group,
        code: generateId().replaceAll('-', '').slice(-12).toUpperCase(),
        name: 'Shared cash',
        createdBy: f.user,
        updatedBy: f.user,
      },
    });
    await client.userGroup.createMany({
      data: [
        { id: generateId(), userId: f.user, groupId: group, role: 'OWNER', createdBy: f.user },
        {
          id: generateId(),
          userId: member.user,
          groupId: group,
          role: 'MEMBER',
          createdBy: f.user,
        },
      ],
    });
    await client.groupAccount.create({
      data: { id: generateId(), groupId: group, accountId: f.cash },
    });
    const item = opening(f);
    await sync.apply(f.user, f.device, item);
    const obligation = await debt(f);
    const leg = await client.transaction.findFirstOrThrow({
      where: { obligationEventId: item.entity_id },
    });
    await client.$transaction(async (tx) => {
      expect(await sync.data(tx, member.user, 'obligations', obligation.id)).toBeNull();
      expect(await sync.data(tx, member.user, 'obligation_events', item.entity_id)).toBeNull();
      const cashRow = await sync.data(tx, member.user, 'transactions', leg.id);
      expect(cashRow?.is_obligation_settlement).toBe(true);
      expect(JSON.stringify(cashRow)).not.toContain('Private lender');
      expect(JSON.stringify(cashRow)).not.toContain(obligation.id);
    });
  });
});
