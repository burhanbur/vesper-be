import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { integrationDatabaseUrl } from '../../src/config/integration-test.js';
import { generateId } from '../../src/common/utils/id.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { SyncRepository } from '../../src/modules/sync/sync.repository.js';
import { PushItemSchema } from '../../src/modules/sync/sync.schema.js';
import { allocationDtos } from '../../src/modules/goals/goal.repository.js';
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
    device = generateId();
  await client.user.create({
    data: { id: user, name: 'Goal test', email: `${user}@example.invalid`, passwordHash: 'unused' },
  });
  await client.accountType.create({
    data: { id: type, userId: user, name: 'Cash', category: 'CASH' },
  });
  await client.account.create({
    data: { id: cash, userId: user, accountTypeId: type, name: 'Private cash', balance: '1000.00' },
  });
  await client.device.create({
    data: { id: device, userId: user, platform: 'Android', name: 'Test', appVersion: '1' },
  });
  return { user, cash, type, device };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function command(
  entity: string,
  id: string,
  payload: object | null,
  operation = 'CREATE',
  version = '0',
) {
  return PushItemSchema.parse({
    entity_type: entity,
    entity_id: id,
    payload,
    operation,
    client_version: version,
  });
}
async function goal(f: Fixture, group: string | null = null, target = '1000.00') {
  const id = generateId();
  await sync.apply(
    f.user,
    f.device,
    command('goals', id, {
      name: 'Test goal',
      currency: 'IDR',
      target_amount: target,
      start_date: '2026-10-21',
      target_date: '2027-10-21',
      group_id: group,
    }),
  );
  return id;
}
async function allocate(f: Fixture, id: string, amount: string) {
  const allocationId = generateId();
  const input = command('goal_allocations', allocationId, {
    goal_id: id,
    account_id: f.cash,
    amount,
  });
  const result = await sync.apply(f.user, f.device, input);
  return { allocationId, input, result };
}
describe('WM08 PostgreSQL goals', () => {
  it('serializes concurrent reservations and replays without touching cash or transactions', async () => {
    const f = await fixture();
    const first = await goal(f),
      second = await goal(f);
    const results = await Promise.allSettled([
      allocate(f, first, '800.00'),
      allocate(f, second, '800.00'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const success = results.find((r) => r.status === 'fulfilled');
    if (success?.status !== 'fulfilled') throw new Error('Expected one allocation');
    expect((await sync.apply(f.user, f.device, success.value.input)).status).toBe('applied');
    expect(await client.goalAllocation.count({ where: { userId: f.user } })).toBe(1);
    expect(
      (await client.account.findUniqueOrThrow({ where: { id: f.cash } })).balance.toFixed(2),
    ).toBe('1000.00');
    expect(await client.transaction.count({ where: { accountId: f.cash } })).toBe(0);
  });
  it('withdrawal releases earmarks, completion requires backing, archive publishes tombstones', async () => {
    const f = await fixture();
    const id = await goal(f);
    const a = await allocate(f, id, '1000.00');
    const finish = command(
      'goals',
      id,
      {
        name: 'Test goal',
        target_amount: '1000.00',
        target_date: '2027-10-21',
        status: 'COMPLETED',
      },
      'UPDATE',
      '1',
    );
    expect((await sync.apply(f.user, f.device, finish)).status).toBe('applied');
    await sync.apply(
      f.user,
      f.device,
      command('goal_allocations', a.allocationId, { amount: '0.00' }, 'UPDATE', '1'),
    );
    const second = await goal(f);
    await allocate(f, second, '1000.00');
    await expect(
      sync.apply(
        f.user,
        f.device,
        command(
          'goals',
          second,
          { ...finish.payload, status: 'COMPLETED', target_amount: '1000.01' },
          'UPDATE',
          '1',
        ),
      ),
    ).rejects.toThrow();
    await sync.apply(f.user, f.device, command('goals', second, null, 'DELETE', '1'));
    expect(
      (await client.goalAllocation.findFirstOrThrow({ where: { goalId: second } })).deletedAt,
    ).not.toBeNull();
    expect(
      await client.syncChange.count({
        where: { userId: f.user, entityType: 'goal_allocations', operation: 'DELETE' },
      }),
    ).toBeGreaterThan(0);
  });
  it('spending recalculates backing once oldest-first and fans out allocation snapshots', async () => {
    const f = await fixture();
    const first = await goal(f),
      second = await goal(f);
    const a = await allocate(f, first, '600.00'),
      b = await allocate(f, second, '400.00');
    const watermark =
      (await client.syncChange.aggregate({ _max: { version: true } }))._max.version ?? 0n;
    await syncClient(client).$transaction(async (tx) => {
      await tx.account.update({
        where: { id: f.cash },
        data: { balance: '400.00', version: { increment: 1 } },
      });
    });
    const rows = await allocationDtos(client, f.user, [a.allocationId, b.allocationId]);
    expect(rows.find((r) => r.id === a.allocationId)?.backed_amount).toBe('400.00');
    expect(rows.find((r) => r.id === b.allocationId)?.backed_amount).toBe('0.00');
    expect(
      await client.syncChange.count({
        where: { userId: f.user, entityType: 'goal_allocations', version: { gt: watermark } },
      }),
    ).toBe(2);
  });
  it('household contributions redact cash identities, enforce contributors and revoke membership', async () => {
    const owner = await fixture(),
      donor = await fixture(),
      stranger = await fixture();
    const group = generateId();
    await client.group.create({
      data: {
        id: group,
        code: group.slice(-12).toUpperCase(),
        name: 'Household',
        createdBy: owner.user,
        updatedBy: owner.user,
      },
    });
    for (const f of [owner, donor])
      await client.userGroup.create({
        data: {
          id: generateId(),
          groupId: group,
          userId: f.user,
          role: f === owner ? 'OWNER' : 'MEMBER',
          createdBy: owner.user,
        },
      });
    const shared = await goal(owner, group),
      personal = await goal(owner);
    expect(await sync.data(client, donor.user, 'goals', personal)).toBeNull();
    expect(await sync.data(client, stranger.user, 'goals', shared)).toBeNull();
    const a = await allocate(donor, shared, '500.00');
    const visible = await sync.data(client, owner.user, 'goal_allocations', a.allocationId);
    expect(visible?.account_id).toBeNull();
    expect(visible?.amount).toBe('500.00');
    await expect(
      sync.apply(
        owner.user,
        owner.device,
        command('goal_allocations', a.allocationId, { amount: '0.00' }, 'UPDATE', '1'),
      ),
    ).rejects.toThrow();
    await syncClient(client).$transaction(async (tx) => {
      await tx.userGroup.delete({
        where: { userId_groupId: { userId: donor.user, groupId: group } },
      });
    });
    expect(await sync.data(client, donor.user, 'goals', shared)).toBeNull();
    const tombstone = await client.syncChange.findFirst({
      where: { userId: donor.user, entityType: 'goals', entityId: shared, operation: 'DELETE' },
    });
    expect(tombstone).not.toBeNull();
    const feed = await sync.pull(donor.user, {
      device_id: donor.device,
      since_version: '0',
      limit: 100,
      compact: 'true',
    });
    expect(feed.changes.find((event) => event.entity_id === shared)?.operation).toBe('DELETE');
    expect(
      feed.changes.find((event) => event.entity_id === a.allocationId)?.payload?.account_id,
    ).toBe(donor.cash);
    await expect(allocate(donor, shared, '100.00')).rejects.toThrow();
    expect(
      (
        await sync.apply(
          donor.user,
          donor.device,
          command('goal_allocations', a.allocationId, { amount: '0.00' }, 'UPDATE', '1'),
        )
      ).status,
    ).toBe('applied');
  });
  it('rejects foreign cash, wrong currency and stale versions; join receives existing goal', async () => {
    const owner = await fixture(),
      other = await fixture();
    const id = await goal(owner);
    await expect(
      sync.apply(
        owner.user,
        owner.device,
        command('goal_allocations', generateId(), {
          goal_id: id,
          account_id: other.cash,
          amount: '10.00',
        }),
      ),
    ).rejects.toThrow();
    const usd = generateId();
    await sync.apply(
      owner.user,
      owner.device,
      command('goals', usd, {
        name: 'USD goal',
        currency: 'USD',
        target_amount: '1000.00',
        start_date: '2026-10-21',
        target_date: '2027-10-21',
        group_id: null,
      }),
    );
    await expect(allocate(owner, usd, '10.00')).rejects.toThrow();
    const changed = command(
      'goals',
      id,
      { name: 'Updated', target_amount: '2000.00', target_date: '2027-10-21', status: 'ACTIVE' },
      'UPDATE',
      '1',
    );
    await sync.apply(owner.user, owner.device, changed);
    expect(
      (
        await sync.apply(
          owner.user,
          owner.device,
          command('goals', id, { ...changed.payload, name: 'Stale' }, 'UPDATE', '1'),
        )
      ).status,
    ).toBe('conflict');
    const group = generateId();
    await client.group.create({
      data: {
        id: group,
        code: group.slice(-12).toUpperCase(),
        name: 'Join',
        createdBy: owner.user,
        updatedBy: owner.user,
      },
    });
    await client.userGroup.create({
      data: {
        id: generateId(),
        groupId: group,
        userId: owner.user,
        role: 'OWNER',
        createdBy: owner.user,
      },
    });
    const shared = await goal(owner, group);
    await syncClient(client).$transaction(async (tx) => {
      await tx.userGroup.create({
        data: {
          id: generateId(),
          groupId: group,
          userId: other.user,
          role: 'MEMBER',
          createdBy: owner.user,
        },
      });
    });
    expect(await sync.data(client, other.user, 'goals', shared)).not.toBeNull();
    expect(
      await client.syncChange.count({
        where: { userId: other.user, entityType: 'goals', entityId: shared },
      }),
    ).toBeGreaterThan(0);
  });
});
