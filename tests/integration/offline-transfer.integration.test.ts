import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { integrationDatabaseUrl } from '../../src/config/integration-test.js';
import { generateId } from '../../src/common/utils/id.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { PrismaTransferRepository } from '../../src/modules/transfers/transfer.repository.js';
import { SyncRepository } from '../../src/modules/sync/sync.repository.js';
import { PushItemSchema } from '../../src/modules/sync/sync.schema.js';

// Validation happens before even constructing a client; no default application client.
const client = new PrismaClient({
  adapter: new PrismaPg({ connectionString: integrationDatabaseUrl() }),
});
const repository = new PrismaTransferRepository(client);
const sync = new SyncRepository(client);

async function fixture() {
  const userId = generateId();
  await client.user.create({
    data: {
      id: userId,
      name: 'Integration',
      email: `${userId}@example.invalid`,
      passwordHash: 'unused-integration-fixture',
    },
  });
  const typeId = generateId();
  await client.accountType.create({ data: { id: typeId, userId, name: 'Integration cash' } });
  const from = generateId();
  const to = generateId();
  await client.account.createMany({
    data: [from, to].map((id) => ({
      id,
      userId,
      accountTypeId: typeId,
      name: 'Integration account',
    })),
  });
  const devices = [generateId(), generateId()];
  await client.device.createMany({
    data: devices.map((id) => ({
      id,
      userId,
      name: 'Integration device',
      platform: 'Android',
      appVersion: 'test',
    })),
  });
  const deviceId = devices[0];
  const otherDeviceId = devices[1];
  if (!deviceId || !otherDeviceId) throw new Error('Missing fixture devices');
  const id = generateId();
  const payload = {
    from_account_id: from,
    to_account_id: to,
    from_transaction_id: generateId(),
    to_transaction_id: generateId(),
    amount: '12.30',
    transacted_at: '2026-10-15T10:00:00.000Z',
    description: null,
  };
  const item = PushItemSchema.parse({
    entity_type: 'transfers',
    entity_id: id,
    operation: 'CREATE',
    client_version: '0',
    payload,
  });
  return { userId, from, to, deviceId, otherDeviceId, id, payload, item };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function accounts(f: Fixture) {
  return client.account.findMany({ where: { id: { in: [f.from, f.to] } }, orderBy: { id: 'asc' } });
}
async function snapshot(f: Fixture) {
  return {
    accounts: await accounts(f),
    transfers: await client.transfer.findMany({
      where: { createdBy: f.userId },
      orderBy: { id: 'asc' },
    }),
    transactions: await client.transaction.findMany({
      where: { createdBy: f.userId },
      orderBy: { id: 'asc' },
    }),
    events: await client.syncChange.findMany({
      where: { userId: f.userId },
      orderBy: { version: 'asc' },
    }),
  };
}
async function assertLedger(f: Fixture, amount = '12.3', version = 2n) {
  const rows = await accounts(f);
  expect(rows).toHaveLength(2);
  expect(rows.find((row) => row.id === f.from)?.balance.toString()).toBe(`-${amount}`);
  expect(rows.find((row) => row.id === f.to)?.balance.toString()).toBe(amount);
  expect(rows.map((row) => row.version)).toEqual([version, version]);
  const legs = await client.transaction.findMany({ where: { transferId: f.id } });
  expect(legs).toHaveLength(2);
  expect(legs.find((row) => row.id === f.payload.from_transaction_id)).toMatchObject({
    accountId: f.from,
    type: 'TRANSFER',
    categoryId: null,
    version: 1n,
  });
  expect(legs.find((row) => row.id === f.payload.from_transaction_id)?.amount.toString()).toBe(
    `-${f.payload.amount === '12.30' ? '12.3' : f.payload.amount}`,
  );
  expect(legs.find((row) => row.id === f.payload.to_transaction_id)?.amount.toString()).toBe(
    '12.3',
  );
}

beforeAll(async () => {
  const identity = await client.$queryRaw<
    { database: string; username: string }[]
  >`SELECT current_database() AS database, current_user AS username`;
  expect(identity).toEqual([
    { database: 'vesper_integration_test', username: 'vesper_integration' },
  ]);
});
afterAll(async () => {
  await client.$disconnect();
});

describe('offline transfers on isolated PostgreSQL (no mocked Prisma or ledger)', () => {
  it('serializes simultaneous identical repository commands and preserves exact signed legs', async () => {
    const f = await fixture();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => repository.createOffline(f.userId, f.id, f.payload)),
    );
    expect(results.map((row) => row.id)).toEqual([f.id, f.id, f.id, f.id]);
    expect(await client.transfer.count({ where: { id: f.id } })).toBe(1);
    await assertLedger(f);
    const before = await snapshot(f);
    await repository.createOffline(f.userId, f.id, { ...f.payload, amount: '12.3' });
    expect(await snapshot(f)).toEqual(before);
  });

  it('serializes distinct opposite-direction commands without lost balances or deadlocks', async () => {
    const f = await fixture();
    await Promise.all([
      repository.createOffline(f.userId, f.id, f.payload),
      repository.createOffline(f.userId, generateId(), {
        ...f.payload,
        from_account_id: f.to,
        to_account_id: f.from,
        from_transaction_id: generateId(),
        to_transaction_id: generateId(),
        amount: '2.10',
      }),
    ]);
    await assertLedger(f, '10.2', 3n);
    expect(await client.transaction.count({ where: { createdBy: f.userId } })).toBe(4);
  });

  it('rejects changed command data without modifying persisted ledger or publication', async () => {
    const f = await fixture();
    await sync.apply(f.userId, f.deviceId, f.item);
    const before = await snapshot(f);
    await expect(
      repository.createOffline(f.userId, f.id, { ...f.payload, amount: '13' }),
    ).rejects.toMatchObject({ code: 'TRANSFER_COMMAND_CONFLICT' });
    await expect(
      repository.createOffline(f.userId, f.id, { ...f.payload, to_transaction_id: generateId() }),
    ).rejects.toMatchObject({ code: 'TRANSFER_COMMAND_CONFLICT' });
    expect(await snapshot(f)).toEqual(before);
  });

  it('rolls back the parent and both legs on a real unique constraint failure', async () => {
    const f = await fixture();
    const before = await snapshot(f);
    await expect(
      repository.createOffline(f.userId, f.id, {
        ...f.payload,
        to_transaction_id: f.payload.from_transaction_id,
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(await snapshot(f)).toEqual(before);
  });

  it('rolls back ledger, earlier balance updates and publication when balance recomputation fails', async () => {
    const f = await fixture();
    // The final sorted account fails after the earlier balance has already been updated.
    const last = [f.from, f.to].sort().at(-1);
    if (!last) throw new Error('Missing account');
    await client.account.update({ where: { id: last }, data: { version: 9223372036854775807n } });
    const before = await snapshot(f);
    await expect(sync.apply(f.userId, f.deviceId, f.item)).rejects.toMatchObject({
      code: 'ACCOUNT_LEDGER_LIMIT',
    });
    expect(await snapshot(f)).toEqual(before);
  });

  it('publishes committed legs/accounts, pulls them, and replays from another device without events', async () => {
    const f = await fixture();
    const results = await Promise.all([
      sync.apply(f.userId, f.deviceId, f.item),
      sync.apply(f.userId, f.otherDeviceId, f.item),
    ]);
    expect(results.map((result) => result.status)).toEqual(['applied', 'applied']);
    await assertLedger(f);
    const before = await snapshot(f);
    const legs = before.events.filter((event) => event.entityType === 'transactions');
    expect(legs.map((event) => event.entityId).sort()).toEqual(
      [f.payload.from_transaction_id, f.payload.to_transaction_id].sort(),
    );
    expect(legs.every((event) => event.operation === 'CREATE')).toBe(true);
    expect(new Set(before.events.map((event) => event.deviceId)).size).toBe(1);
    expect(
      before.events
        .filter((event) => event.entityType === 'accounts')
        .map((event) => event.entityId)
        .sort(),
    ).toEqual([f.from, f.to].sort());
    expect(before.events.some((event) => event.entityType === 'transfers')).toBe(false);
    const pull = await sync.pull(f.userId, {
      device_id: f.otherDeviceId,
      since_version: '0',
      limit: 100,
    });
    expect(
      pull.changes
        .filter((change) => change.entity_type === 'transactions')
        .map((change) => change.entity_id)
        .sort(),
    ).toEqual([f.payload.from_transaction_id, f.payload.to_transaction_id].sort());
    expect(pull.has_more).toBe(false);
    await sync.apply(f.userId, f.otherDeviceId, f.item);
    expect(await snapshot(f)).toEqual(before);
  });
});
