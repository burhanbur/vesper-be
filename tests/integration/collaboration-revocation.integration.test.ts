import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, describe, expect, it } from 'vitest';
import { integrationDatabaseUrl } from '../../src/config/integration-test.js';
import { generateId } from '../../src/common/utils/id.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { syncClient } from '../../src/infrastructure/database/sync-publication.js';
import { CollaborationRepository } from '../../src/modules/groups/collaboration.repository.js';
import { PrismaGroupRepository } from '../../src/modules/groups/group.repository.js';

const client = new PrismaClient({
  adapter: new PrismaPg({ connectionString: integrationDatabaseUrl() }),
});
const published = syncClient(client);
const collaboration = new CollaborationRepository(published);
const groups = new PrismaGroupRepository(published);
afterAll(async () => {
  await client.$disconnect();
});

async function fixture() {
  const owner = generateId(),
    member = generateId(),
    groupId = generateId();
  for (const id of [owner, member]) {
    await client.user.create({
      data: {
        id,
        name: 'Revocation test',
        email: `${id}@example.invalid`,
        passwordHash: 'unused-isolated-fixture',
      },
    });
  }
  await client.group.create({
    data: {
      id: groupId,
      name: 'Isolated group',
      code: generateId().replaceAll('-', '').slice(0, 12).toUpperCase(),
      createdBy: owner,
      updatedBy: owner,
    },
  });
  await client.userGroup.createMany({
    data: [
      { id: generateId(), userId: owner, groupId, role: 'OWNER', createdBy: owner },
      { id: generateId(), userId: member, groupId, role: 'MEMBER', createdBy: owner },
    ],
  });
  const accountTypeId = generateId(),
    accountId = generateId();
  const categoryId = generateId(),
    groupCategoryId = generateId(),
    transactionId = generateId();
  await client.accountType.create({
    data: { id: accountTypeId, userId: member, name: 'Cash', category: 'CASH' },
  });
  await client.account.create({
    data: {
      id: accountId,
      userId: member,
      accountTypeId,
      name: 'Private cash',
      balance: '9007199254740993.01',
    },
  });
  await client.category.create({
    data: { id: categoryId, userId: member, name: 'Private expense', type: 'EXPENSE' },
  });
  await client.groupCategory.create({
    data: {
      id: groupCategoryId,
      groupId,
      name: 'Shared expense',
      type: 'EXPENSE',
      createdBy: owner,
      updatedBy: owner,
    },
  });
  await client.transaction.create({
    data: {
      id: transactionId,
      accountId,
      categoryId,
      type: 'EXPENSE',
      amount: '12.34',
      transactedAt: new Date('2026-10-01T00:00:00.000Z'),
      createdBy: member,
      updatedBy: member,
    },
  });
  return { owner, member, groupId, accountId, categoryId, groupCategoryId, transactionId };
}

describe('concurrent collaboration revocation on isolated PostgreSQL', () => {
  it('serializes sharing and mapping against removal without surviving grants or lost personal data', async () => {
    const f = await fixture();
    const results = await Promise.allSettled([
      groups.share(f.member, f.groupId, f.accountId, false),
      groups.mapping(f.member, f.groupId, f.groupCategoryId, f.categoryId, false),
      collaboration.manage(f.owner, f.groupId, f.member, 'REMOVE'),
    ]);
    expect(results[2]?.status).toBe('fulfilled');
    for (const result of results.slice(0, 2)) {
      if (result.status === 'rejected') expect(result.reason).toMatchObject({ statusCode: 403 });
    }
    expect(await client.userGroup.count({ where: { groupId: f.groupId, userId: f.member } })).toBe(
      0,
    );
    expect(await client.groupAccount.count({ where: { groupId: f.groupId } })).toBe(0);
    expect(await client.mappingGroupCategory.count({ where: { groupId: f.groupId } })).toBe(0);
    expect(
      (await client.account.findUniqueOrThrow({ where: { id: f.accountId } })).balance.toString(),
    ).toBe('9007199254740993.01');
    expect(
      (
        await client.transaction.findUniqueOrThrow({ where: { id: f.transactionId } })
      ).amount.toString(),
    ).toBe('12.34');
    expect(await client.category.count({ where: { id: f.categoryId, deletedAt: null } })).toBe(1);
    await expect(collaboration.read(f.member, f.groupId, '2026-10', 1, 20)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('allows exactly one ownership-transfer/self-leave winner and always retains one owner', async () => {
    const f = await fixture();
    const results = await Promise.allSettled([
      collaboration.manage(f.owner, f.groupId, f.member, 'TRANSFER_OWNER'),
      collaboration.manage(f.member, f.groupId, f.member, 'REMOVE'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    for (const result of results) {
      if (result.status === 'rejected') expect(result.reason).toMatchObject({ statusCode: 403 });
    }
    expect(await client.userGroup.count({ where: { groupId: f.groupId, role: 'OWNER' } })).toBe(1);
    expect(await client.account.count({ where: { id: f.accountId, deletedAt: null } })).toBe(1);
    expect(
      await client.transaction.count({ where: { id: f.transactionId, deletedAt: null } }),
    ).toBe(1);
  });

  it('concurrent reads use one authorized snapshot, and all new reads deny after removal commits', async () => {
    const f = await fixture();
    await groups.share(f.member, f.groupId, f.accountId, false);
    await groups.mapping(f.member, f.groupId, f.groupCategoryId, f.categoryId, false);
    const [read, removal] = await Promise.allSettled([
      collaboration.read(f.member, f.groupId, '2026-10', 1, 20),
      collaboration.manage(f.owner, f.groupId, f.member, 'REMOVE'),
    ]);
    expect(removal.status).toBe('fulfilled');
    // A read authorized before revocation linearizes before it. It may finish
    // with that complete snapshot; a read starting after commit must deny.
    if (read.status === 'fulfilled') {
      expect(read.value.balances).toEqual([{ currency: 'IDR', balance: '9007199254740993.01' }]);
      expect(read.value.contributions).toEqual([
        { user_id: f.member, currency: 'IDR', income: '0', expense: '12.34' },
      ]);
      expect(read.value.feed).toHaveLength(1);
    } else {
      expect(read.reason).toMatchObject({ statusCode: 403 });
    }
    await expect(collaboration.read(f.member, f.groupId, '2026-10', 1, 20)).rejects.toMatchObject({
      statusCode: 403,
    });
    const current = await collaboration.read(f.owner, f.groupId, '2026-10', 1, 20);
    expect(current.balances).toEqual([]);
    expect(current.contributions).toEqual([]);
    expect(current.feed).toEqual([]);
    expect(await client.transaction.count({ where: { id: f.transactionId } })).toBe(1);
  });
});
