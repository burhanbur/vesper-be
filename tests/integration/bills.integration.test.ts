import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { integrationDatabaseUrl } from '../../src/config/integration-test.js';
import { generateId } from '../../src/common/utils/id.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { SyncRepository } from '../../src/modules/sync/sync.repository.js';
import { PushItemSchema } from '../../src/modules/sync/sync.schema.js';
import { billOccurrenceId } from '../../src/modules/bills/bill.schema.js';
import { syncClient } from '../../src/infrastructure/database/sync-publication.js';

const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: integrationDatabaseUrl() }),
  }),
  sync = new SyncRepository(client);
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
    category = generateId(),
    income = generateId(),
    device = generateId(),
    bill = generateId();
  await client.user.create({
    data: { id: user, name: 'Bill test', email: `${user}@example.invalid`, passwordHash: 'unused' },
  });
  await client.accountType.create({
    data: { id: type, userId: user, name: 'Cash', category: 'CASH' },
  });
  await client.account.create({
    data: { id: cash, userId: user, accountTypeId: type, name: 'Cash', balance: '1000.00' },
  });
  await client.category.createMany({
    data: [
      { id: category, userId: user, name: 'Rent', type: 'EXPENSE' },
      { id: income, userId: user, name: 'Opening', type: 'INCOME' },
    ],
  });
  await client.transaction.create({
    data: {
      id: generateId(),
      accountId: cash,
      categoryId: income,
      type: 'INCOME',
      amount: '1000.00',
      transactedAt: new Date('2026-01-01T00:00:00Z'),
      createdBy: user,
      updatedBy: user,
    },
  });
  await client.device.create({
    data: { id: device, userId: user, platform: 'Android', name: 'Test', appVersion: '1' },
  });
  await sync.apply(
    user,
    device,
    PushItemSchema.parse({
      entity_type: 'bill_schedules',
      entity_id: bill,
      operation: 'CREATE',
      client_version: '0',
      payload: {
        title: 'Rent',
        transaction_type: 'EXPENSE',
        amount_type: 'FIXED',
        amount: '100.00',
        account_id: cash,
        category_id: category,
        obligation_id: null,
        frequency: 'MONTHLY',
        anchor_date: '2026-01-31',
        end_date: null,
        utc_offset_minutes: 420,
        reminder_enabled: true,
        reminder_days: 3,
      },
    }),
  );
  return { user, cash, type, category, income, device, bill };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function command(f: Fixture, action = 'PAY', extra: Record<string, unknown> = {}) {
  return PushItemSchema.parse({
    entity_type: 'bill_commands',
    entity_id: generateId(),
    operation: 'CREATE',
    client_version: '0',
    payload: {
      bill_id: f.bill,
      due_date: '2026-02-28',
      action,
      expected_version: '0',
      amount: action === 'PAY' ? '100.00' : null,
      record_id: null,
      ledger_id: generateId(),
      transacted_at: '2026-02-28T10:00:00.000Z',
      note: action === 'SKIP' ? 'Waived' : '',
      ...extra,
    },
  });
}
async function balance(f: Fixture) {
  return (await client.account.findUniqueOrThrow({ where: { id: f.cash } })).balance.toFixed(2);
}
describe('WM10 PostgreSQL bills', () => {
  it('concurrent identical replay creates one occurrence/ledger and spends once', async () => {
    const f = await fixture(),
      item = command(f);
    const results = await Promise.all([
      sync.apply(f.user, f.device, item),
      sync.apply(f.user, f.device, item),
    ]);
    expect(results.map((r) => r.status)).toEqual(['applied', 'applied']);
    expect(await balance(f)).toBe('900.00');
    expect(await client.billOccurrence.count({ where: { billId: f.bill } })).toBe(1);
    expect(await client.transaction.count({ where: { billCommandId: item.entity_id } })).toBe(1);
  });
  it('different devices cannot double-pay one due date and cancellation reserves the losing ledger UUID', async () => {
    const f = await fixture(),
      otherDevice = generateId();
    await client.device.create({
      data: { id: otherDevice, userId: f.user, platform: 'Web', name: 'Other', appVersion: '1' },
    });
    const a = command(f),
      b = command(f);
    const results = await Promise.all([
      sync.apply(f.user, f.device, a),
      sync.apply(f.user, otherDevice, b),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['applied', 'conflict']);
    expect(await balance(f)).toBe('900.00');
    const loser = results[0]?.status === 'conflict' ? a : b;
    const cancelled = PushItemSchema.parse({ ...loser, entity_type: 'bill_cancellations' });
    expect((await sync.apply(f.user, f.device, cancelled)).status).toBe('applied');
    const ledger =
      loser.payload && 'ledger_id' in loser.payload ? String(loser.payload.ledger_id) : '';
    await expect(
      client.transaction.create({
        data: {
          id: ledger,
          accountId: f.cash,
          categoryId: f.category,
          type: 'EXPENSE',
          amount: '1',
          transactedAt: new Date(),
          createdBy: f.user,
          updatedBy: f.user,
        },
      }),
    ).rejects.toThrow();
    expect(await balance(f)).toBe('900.00');
  });
  it('skip/reopen/link existing payment changes status without new financial rows; corrections invalidate evidence', async () => {
    const f = await fixture();
    await sync.apply(f.user, f.device, command(f, 'SKIP'));
    expect(await balance(f)).toBe('1000.00');
    await sync.apply(f.user, f.device, command(f, 'REOPEN', { expected_version: '1' }));
    const record = generateId();
    await client.transaction.create({
      data: {
        id: record,
        accountId: f.cash,
        categoryId: f.category,
        type: 'EXPENSE',
        amount: '100',
        transactedAt: new Date('2026-02-28'),
        createdBy: f.user,
        updatedBy: f.user,
      },
    });
    await sync.apply(
      f.user,
      f.device,
      command(f, 'LINK_TRANSACTION', { expected_version: '2', record_id: record }),
    );
    expect(await client.transaction.count({ where: { accountId: f.cash } })).toBe(2);
    await syncClient(client).$transaction(async (tx) => {
      await tx.transaction.update({
        where: { id: record },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      });
    });
    const occurrence = await sync.data(
      client,
      f.user,
      'bill_occurrences',
      billOccurrenceId(f.bill, '2026-02-28'),
    );
    expect(occurrence?.status).toBe('NEEDS_REVIEW');
    expect(
      await client.syncChange.count({ where: { userId: f.user, entityType: 'bill_occurrences' } }),
    ).toBeGreaterThan(2);
  });
  it('cancel-before-apply replays safely, invalid dates/amounts and foreign ownership reject', async () => {
    const f = await fixture(),
      other = await fixture(),
      item = command(f);
    await sync.apply(
      f.user,
      f.device,
      PushItemSchema.parse({ ...item, entity_type: 'bill_cancellations' }),
    );
    expect((await sync.apply(f.user, f.device, item)).status).toBe('conflict');
    expect(await balance(f)).toBe('1000.00');
    expect(await sync.data(client, other.user, 'bill_schedules', f.bill)).toBeNull();
    await expect(sync.apply(other.user, other.device, command(f))).rejects.toThrow();
    await expect(
      sync.apply(f.user, f.device, command(f, 'PAY', { due_date: '2026-03-28' })),
    ).rejects.toThrow();
    await expect(
      sync.apply(f.user, f.device, command(f, 'PAY', { amount: '99.00' })),
    ).rejects.toThrow();
    expect(await client.billOccurrence.count({ where: { billId: f.bill } })).toBe(0);
  });
  it('linked debt installments share principal evidence without a second expense and reverse to review', async () => {
    const f = await fixture(),
      debt = generateId(),
      event = generateId(),
      bill = generateId();
    await client.obligation.create({
      data: {
        id: debt,
        userId: f.user,
        kind: 'PAYABLE',
        counterparty: 'Loan',
        currency: 'IDR',
        principal: '300',
        outstanding: '100',
        installments: [
          { due_date: '2026-02-28', principal: '100.00' },
          { due_date: '2026-03-31', principal: '100.00' },
          { due_date: '2026-04-30', principal: '100.00' },
        ],
      },
    });
    await client.obligationEvent.create({
      data: {
        id: event,
        userId: f.user,
        obligationId: debt,
        operation: 'REPAY',
        principal: '200',
        interest: '0',
        fee: '0',
        cashAccountId: f.cash,
        command: {},
        fingerprint: '0'.repeat(64),
        transactedAt: new Date('2026-02-28'),
      },
    });
    await sync.apply(
      f.user,
      f.device,
      PushItemSchema.parse({
        entity_type: 'bill_schedules',
        entity_id: bill,
        operation: 'CREATE',
        client_version: '0',
        payload: {
          title: 'Loan installments',
          transaction_type: 'EXPENSE',
          amount_type: 'FIXED',
          amount: '100.00',
          account_id: f.cash,
          category_id: null,
          obligation_id: debt,
          frequency: 'INSTALLMENTS',
          anchor_date: '2026-02-28',
          end_date: null,
          utc_offset_minutes: 420,
          reminder_enabled: true,
          reminder_days: 3,
        },
      }),
    );
    const linked = { ...f, bill };
    await sync.apply(f.user, f.device, command(linked, 'LINK_OBLIGATION', { record_id: event }));
    await sync.apply(
      f.user,
      f.device,
      command(linked, 'LINK_OBLIGATION', { record_id: event, due_date: '2026-03-31' }),
    );
    await expect(
      sync.apply(
        f.user,
        f.device,
        command(linked, 'LINK_OBLIGATION', { record_id: event, due_date: '2026-04-30' }),
      ),
    ).rejects.toThrow();
    expect(await client.transaction.count({ where: { accountId: f.cash } })).toBe(1);
    expect(await balance(f)).toBe('1000.00');
    await syncClient(client).$transaction(async (tx) => {
      await tx.obligationEvent.update({ where: { id: event }, data: { reversedAt: new Date() } });
    });
    expect(
      (await sync.data(client, f.user, 'bill_occurrences', billOccurrenceId(bill, '2026-02-28')))
        ?.status,
    ).toBe('NEEDS_REVIEW');
  });
});
