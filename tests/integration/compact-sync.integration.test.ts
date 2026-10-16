import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, describe, expect, it } from 'vitest';
import { integrationDatabaseUrl } from '../../src/config/integration-test.js';
import { generateId } from '../../src/common/utils/id.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { SyncRepository } from '../../src/modules/sync/sync.repository.js';

const client = new PrismaClient({
  adapter: new PrismaPg({ connectionString: integrationDatabaseUrl() }),
  log: [{ emit: 'event', level: 'query' }],
});
const queries: string[] = [];
client.$on('query', (event) => queries.push(event.query));
const sync = new SyncRepository(client);
afterAll(async () => {
  await client.$disconnect();
});

async function fixture(count = 3) {
  const userId = generateId(),
    deviceId = generateId(),
    typeId = generateId(),
    accountId = generateId(),
    categoryId = generateId();
  await client.user.create({
    data: {
      id: userId,
      name: 'Compact sync fixture',
      email: `${userId}@example.invalid`,
      passwordHash: 'unused-isolated-fixture',
    },
  });
  await client.device.create({
    data: {
      id: deviceId,
      userId,
      name: 'Isolated device',
      platform: 'Android',
      appVersion: 'test',
    },
  });
  await client.accountType.create({ data: { id: typeId, userId, name: 'Cash' } });
  await client.account.create({
    data: {
      id: accountId,
      userId,
      accountTypeId: typeId,
      name: 'Exact cash',
      balance: '9007199254740993.01',
    },
  });
  await client.category.create({
    data: { id: categoryId, userId, name: 'Income', type: 'INCOME' },
  });
  const ids = Array.from({ length: count }, () => generateId());
  await client.transaction.createMany({
    data: ids.map((id) => ({
      id,
      accountId,
      categoryId,
      type: 'INCOME',
      amount: '12.34',
      transactedAt: new Date('2026-10-16T00:00:00.000Z'),
      createdBy: userId,
      updatedBy: userId,
    })),
  });
  async function event(id: string, entityType = 'transactions', operation = 'UPDATE') {
    return client.syncChange.create({
      data: { id: generateId(), userId, entityType, entityId: id, operation },
    });
  }
  return { userId, deviceId, typeId, accountId, ids, event };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function readAll(f: Fixture, compact: boolean, limit = 100) {
  let cursor = '0';
  const changes = [];
  let pages = 0;
  while (true) {
    const page = await sync.pull(f.userId, {
      device_id: f.deviceId,
      since_version: cursor,
      limit,
      ...(compact ? { compact: 'true' as const } : {}),
    });
    expect(page.changes.length).toBeLessThanOrEqual(limit);
    expect(BigInt(page.next_version)).toBeGreaterThanOrEqual(BigInt(cursor));
    changes.push(...page.changes);
    cursor = page.next_version;
    pages++;
    if (!page.has_more) return { changes, cursor, pages };
    if (pages > 100) throw new Error('Non-advancing test feed');
  }
}

describe('compact sync on isolated PostgreSQL', () => {
  it('converges to the legacy stream with bounded unique rows and leaves events/money intact', async () => {
    const f = await fixture(105);
    await client.syncChange.createMany({
      data: Array.from({ length: 5 }, () => f.ids)
        .flat()
        .map((id) => ({
          id: generateId(),
          userId: f.userId,
          entityType: 'transactions',
          entityId: id,
          operation: 'UPDATE',
        })),
    });
    await f.event(f.accountId, 'accounts');
    const beforeCount = await client.syncChange.count({ where: { userId: f.userId } });
    const legacy = await readAll(f, false);
    const compact = await readAll(f, true);
    const snapshots = (changes: typeof legacy.changes) =>
      new Map(
        changes.map((change) => [`${change.entity_type}:${change.entity_id}`, change.payload]),
      );
    expect(snapshots(compact.changes)).toEqual(snapshots(legacy.changes));
    expect(compact.changes).toHaveLength(106);
    expect(compact.pages).toBe(2);
    expect(legacy.pages).toBe(6);
    expect(compact.cursor).toBe(legacy.cursor);
    expect(
      compact.changes
        .filter((row) => row.entity_type === 'transactions')
        .every((row) => row.payload?.amount === '12.34'),
    ).toBe(true);
    expect(compact.changes.find((row) => row.entity_type === 'accounts')?.payload?.balance).toBe(
      '9007199254740993.01',
    );
    expect(await client.syncChange.count({ where: { userId: f.userId } })).toBe(beforeCount);
    expect(
      (await client.account.findUniqueOrThrow({ where: { id: f.accountId } })).balance.toString(),
    ).toBe('9007199254740993.01');
  });

  it('uses one bounded payload query per ledger table instead of one per event', async () => {
    const f = await fixture(100);
    await client.syncChange.createMany({
      data: f.ids.map((id) => ({
        id: generateId(),
        userId: f.userId,
        entityType: 'transactions',
        entityId: id,
        operation: 'CREATE',
      })),
    });
    queries.length = 0;
    const page = await sync.pull(f.userId, {
      device_id: f.deviceId,
      since_version: '0',
      limit: 100,
      compact: 'true',
    });
    expect(page.changes).toHaveLength(100);
    expect(queries.filter((query) => /FROM\s+"public"\."transactions"/i.test(query))).toHaveLength(
      1,
    );
  });

  it('retains tombstones, replays the same cursor and catches a newer write between pages', async () => {
    const f = await fixture();
    const [first, second, deleted] = f.ids;
    if (!first || !second || !deleted) throw new Error('Missing fixture rows');
    await f.event(first);
    await f.event(second);
    await client.transaction.update({ where: { id: deleted }, data: { deletedAt: new Date() } });
    await f.event(deleted, 'transactions', 'DELETE');
    const query = { device_id: f.deviceId, since_version: '0', limit: 1, compact: 'true' as const };
    const initial = await sync.pull(f.userId, query);
    const replay = await sync.pull(f.userId, query);
    expect(replay.changes).toEqual(initial.changes);
    await client.transaction.update({ where: { id: first }, data: { amount: '99.99' } });
    await f.event(first);
    const remaining = await sync.pull(f.userId, {
      ...query,
      since_version: initial.next_version,
      limit: 100,
    });
    expect(remaining.changes.map((row) => row.entity_id)).toEqual([second, deleted, first]);
    expect(remaining.changes.find((row) => row.entity_id === deleted)).toMatchObject({
      operation: 'DELETE',
      payload: null,
    });
    expect(remaining.changes.find((row) => row.entity_id === first)?.payload?.amount).toBe('99.99');
  });

  it('rechecks shared-account access after revocation and rejects another owner device', async () => {
    const f = await fixture(1),
      member = await fixture(1),
      groupId = generateId();
    const id = f.ids[0];
    if (!id) throw new Error('Missing fixture row');
    await client.group.create({
      data: {
        id: groupId,
        name: 'Isolated group',
        code: generateId().replaceAll('-', '').slice(0, 12).toUpperCase(),
        createdBy: f.userId,
        updatedBy: f.userId,
      },
    });
    await client.userGroup.create({
      data: {
        id: generateId(),
        userId: member.userId,
        groupId,
        role: 'MEMBER',
        createdBy: f.userId,
      },
    });
    await client.groupAccount.create({
      data: { id: generateId(), groupId, accountId: f.accountId },
    });
    await client.syncChange.createMany({
      data: Array.from({ length: 3 }, () => ({
        id: generateId(),
        userId: member.userId,
        entityType: 'transactions',
        entityId: id,
        operation: 'UPDATE',
      })),
    });
    const query = {
      device_id: member.deviceId,
      since_version: '0',
      limit: 100,
      compact: 'true' as const,
    };
    expect((await sync.pull(member.userId, query)).changes[0]?.payload?.id).toBe(id);
    await client.group.update({ where: { id: groupId }, data: { isActive: false } });
    expect((await sync.pull(member.userId, query)).changes[0]).toMatchObject({
      entity_id: id,
      operation: 'DELETE',
      payload: null,
    });
    await expect(
      sync.pull(member.userId, { ...query, device_id: f.deviceId }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect((await sync.pull(f.userId, { ...query, device_id: f.deviceId })).changes).toHaveLength(
      0,
    );
  });
});
