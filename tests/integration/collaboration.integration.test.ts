import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, describe, expect, it } from 'vitest';
import { integrationDatabaseUrl } from '../../src/config/integration-test.js';
import { generateId } from '../../src/common/utils/id.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { CollaborationRepository } from '../../src/modules/groups/collaboration.repository.js';
import { syncClient } from '../../src/infrastructure/database/sync-publication.js';

const client = new PrismaClient({
  adapter: new PrismaPg({ connectionString: integrationDatabaseUrl() }),
});
const repository = new CollaborationRepository(syncClient(client));
afterAll(async () => {
  await client.$disconnect();
});

describe('collaboration isolated PostgreSQL', () => {
  it('filters private/unmapped/deleted/foreign history and revokes without deleting personal records', async () => {
    const actor = generateId(),
      member = generateId(),
      outsider = generateId(),
      groupId = generateId();
    for (const userId of [actor, member, outsider]) {
      await client.user.create({
        data: {
          id: userId,
          name: 'Collaboration',
          email: `${userId}@example.invalid`,
          passwordHash: 'unused-test-fixture',
        },
      });
    }
    await client.group.create({
      data: {
        id: groupId,
        name: 'Household',
        code: generateId().replaceAll('-', '').slice(0, 12).toUpperCase(),
        createdBy: actor,
        updatedBy: actor,
      },
    });
    await client.userGroup.createMany({
      data: [actor, member].map((userId) => ({
        id: generateId(),
        userId,
        groupId,
        role: userId === actor ? ('OWNER' as const) : ('MEMBER' as const),
        createdBy: actor,
      })),
    });
    const type = generateId(),
      cash = generateId(),
      privateCash = generateId(),
      investment = generateId(),
      investmentType = generateId();
    await client.accountType.createMany({
      data: [
        { id: type, userId: member, name: 'Cash', category: 'CASH' },
        { id: investmentType, userId: member, name: 'Investment', category: 'INVESTMENT' },
      ],
    });
    await client.account.createMany({
      data: [
        {
          id: cash,
          userId: member,
          accountTypeId: type,
          name: 'Private account label',
          balance: '9007199254740993.01',
        },
        {
          id: privateCash,
          userId: member,
          accountTypeId: type,
          name: 'Never shared',
          balance: '100',
        },
        {
          id: investment,
          userId: member,
          accountTypeId: investmentType,
          name: 'Investment',
          balance: '999',
        },
      ],
    });
    await client.groupAccount.createMany({
      data: [cash, investment].map((accountId) => ({ id: generateId(), groupId, accountId })),
    });
    const category = generateId(),
      unmapped = generateId(),
      gc = generateId();
    await client.category.createMany({
      data: [category, unmapped].map((id) => ({
        id,
        userId: member,
        name: 'Private category',
        type: 'EXPENSE',
      })),
    });
    await client.groupCategory.create({
      data: { id: gc, groupId, name: 'Food', type: 'EXPENSE', createdBy: actor, updatedBy: actor },
    });
    await client.mappingGroupCategory.create({
      data: { id: generateId(), groupId, userCategoryId: category, groupCategoryId: gc },
    });
    for (const [accountId, categoryId, deletedAt, date] of [
      [cash, category, null, '2026-10-01T00:00:00.000Z'],
      [privateCash, category, null, '2026-10-01T00:00:00.000Z'],
      [cash, unmapped, null, '2026-10-01T00:00:00.000Z'],
      [cash, category, new Date(), '2026-10-01T00:00:00.000Z'],
      [cash, category, null, '2026-11-01T00:00:00.000Z'],
    ] as const) {
      await client.transaction.create({
        data: {
          id: generateId(),
          accountId,
          categoryId,
          type: 'EXPENSE',
          amount: '12.34',
          transactedAt: new Date(date),
          deletedAt,
          createdBy: member,
          updatedBy: member,
        },
      });
    }
    const read = await repository.read(actor, groupId, '2026-10', 1, 20);
    expect(read.balances).toEqual([{ currency: 'IDR', balance: '9007199254740993.01' }]);
    expect(read.contributions).toEqual([
      { user_id: member, currency: 'IDR', income: '0', expense: '12.34' },
    ]);
    expect(read.feed).toHaveLength(1);
    expect(JSON.stringify(read)).not.toContain('Private');
    await expect(repository.read(outsider, groupId, '2026-10', 1, 20)).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(repository.manage(member, groupId, actor, 'REMOVE')).rejects.toMatchObject({
      statusCode: 403,
    });
    await repository.manage(actor, groupId, member, 'REMOVE');
    expect(await client.transaction.count({ where: { createdBy: member } })).toBe(5);
    expect(await client.account.count({ where: { userId: member } })).toBe(3);
    expect(await client.groupAccount.count({ where: { groupId } })).toBe(0);
    expect(await client.mappingGroupCategory.count({ where: { groupId } })).toBe(0);
    expect((await repository.read(actor, groupId, '2026-10', 1, 20)).feed).toEqual([]);
    await expect(repository.read(member, groupId, '2026-10', 1, 20)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(
      await client.syncChange.count({
        where: { userId: actor, operation: 'DELETE', entityType: 'accounts' },
      }),
    ).toBeGreaterThan(0);
  });
});
