import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { integrationDatabaseUrl } from '../../src/config/integration-test.js';
import { generateId } from '../../src/common/utils/id.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { SyncRepository } from '../../src/modules/sync/sync.repository.js';
import { PushItemSchema } from '../../src/modules/sync/sync.schema.js';

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
    category = generateId();
  await client.user.create({
    data: {
      id: user,
      name: 'Emergency test',
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
  await client.category.create({
    data: { id: category, userId: user, type: 'EXPENSE', name: 'Food' },
  });
  await client.device.create({
    data: { id: device, userId: user, platform: 'Android', name: 'Test', appVersion: '1' },
  });
  return { user, cash, type, device, category };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function input(f: Fixture) {
  return {
    currency: 'IDR',
    baseline_mode: 'MANUAL',
    manual_baseline: '300.00',
    coverage_months: 6,
    history_months: 3,
    account_ids: [f.cash],
    category_ids: [f.category],
    goal_id: null,
  };
}
function command(id: string, payload: object | null, operation = 'CREATE', version = '0') {
  return PushItemSchema.parse({
    entity_type: 'emergency_plans',
    entity_id: id,
    payload,
    operation,
    client_version: version,
  });
}
describe('WM09 PostgreSQL emergency plans', () => {
  it('replays array selections exactly, versions updates and never shares private plans', async () => {
    const f = await fixture(),
      other = await fixture(),
      id = generateId(),
      group = generateId();
    await client.group.create({
      data: {
        id: group,
        code: group.slice(-12).toUpperCase(),
        name: 'Shared account',
        createdBy: f.user,
        updatedBy: f.user,
      },
    });
    for (const u of [f.user, other.user])
      await client.userGroup.create({
        data: {
          id: generateId(),
          groupId: group,
          userId: u,
          role: u === f.user ? 'OWNER' : 'MEMBER',
          createdBy: f.user,
        },
      });
    await client.groupAccount.create({
      data: { id: generateId(), groupId: group, accountId: f.cash },
    });
    const item = command(id, input(f));
    const results = await Promise.all([
      sync.apply(f.user, f.device, item),
      sync.apply(f.user, f.device, item),
    ]);
    expect(results.map((r) => r.status)).toEqual(['applied', 'applied']);
    expect(await client.emergencyPlan.count({ where: { userId: f.user } })).toBe(1);
    expect(await sync.data(client, other.user, 'emergency_plans', id)).toBeNull();
    expect(
      await client.syncChange.count({
        where: { userId: other.user, entityType: 'emergency_plans' },
      }),
    ).toBe(0);
    const update = command(id, { ...input(f), coverage_months: 12 }, 'UPDATE', '1');
    expect((await sync.apply(f.user, f.device, update)).status).toBe('applied');
    expect((await sync.apply(f.user, f.device, update)).status).toBe('applied');
    expect(
      (
        await sync.apply(
          f.user,
          f.device,
          command(id, { ...input(f), coverage_months: 9 }, 'UPDATE', '1'),
        )
      ).status,
    ).toBe('conflict');
    const feed = await sync.pull(f.user, {
      device_id: f.device,
      since_version: '0',
      limit: 100,
      compact: 'true',
    });
    expect(feed.changes.find((c) => c.entity_id === id)?.payload?.coverage_months).toBe(12);
  });
  it('rejects foreign assets/categories, ineligible cash and shared/foreign goal references', async () => {
    const f = await fixture(),
      other = await fixture();
    for (const patch of [{ account_ids: [other.cash] }, { category_ids: [other.category] }]) {
      await expect(
        sync.apply(f.user, f.device, command(generateId(), { ...input(f), ...patch })),
      ).rejects.toThrow();
    }
    const foreignGoal = generateId();
    await client.goal.create({
      data: {
        id: foreignGoal,
        userId: other.user,
        name: 'Private goal',
        currency: 'IDR',
        targetAmount: '1000',
        startDate: new Date('2026-10-21'),
        targetDate: new Date('2027-10-21'),
      },
    });
    await expect(
      sync.apply(f.user, f.device, command(generateId(), { ...input(f), goal_id: foreignGoal })),
    ).rejects.toThrow();
    await client.accountType.update({ where: { id: f.type }, data: { category: 'INVESTMENT' } });
    await expect(sync.apply(f.user, f.device, command(generateId(), input(f)))).rejects.toThrow();
    expect(await client.emergencyPlan.count({ where: { userId: f.user } })).toBe(0);
  });
  it('serializes one live plan per owner, soft deletion permits recreation and preserves money', async () => {
    const f = await fixture();
    const ids = [generateId(), generateId()];
    const results = await Promise.allSettled(
      ids.map((id) => sync.apply(f.user, f.device, command(id, input(f)))),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const plan = await client.emergencyPlan.findFirstOrThrow({
      where: { userId: f.user, deletedAt: null },
    });
    await sync.apply(f.user, f.device, command(plan.id, null, 'DELETE', '1'));
    const replacement = generateId();
    await sync.apply(
      f.user,
      f.device,
      command(replacement, { ...input(f), baseline_mode: 'HISTORY', manual_baseline: null }),
    );
    expect(await sync.data(client, f.user, 'emergency_plans', plan.id)).toBeNull();
    expect((await sync.data(client, f.user, 'emergency_plans', replacement))?.baseline_mode).toBe(
      'HISTORY',
    );
    expect(
      (await client.account.findUniqueOrThrow({ where: { id: f.cash } })).balance.toFixed(2),
    ).toBe('1000.00');
    expect(await client.transaction.count({ where: { accountId: f.cash } })).toBe(0);
  });
});
