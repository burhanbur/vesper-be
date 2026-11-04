import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, expect, it } from 'vitest';
import { integrationDatabaseUrl } from '../../src/config/integration-test.js';
import { generateId } from '../../src/common/utils/id.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { PrismaPocketRepository } from '../../src/modules/groups/pocket.repository.js';
import { PrismaGroupRepository } from '../../src/modules/groups/group.repository.js';
import { CollaborationRepository } from '../../src/modules/groups/collaboration.repository.js';
import { syncClient } from '../../src/infrastructure/database/sync-publication.js';

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: integrationDatabaseUrl() }) });
const repository = new PrismaPocketRepository(syncClient(client));
afterAll(async () => { await client.$disconnect(); });

it('persists purpose pockets, exact transparent balances, ownership, consent, leaf safety and revocation', async () => {
    const owner = generateId(), member = generateId(), outsider = generateId(), groupId = generateId();
    for (const id of [owner, member, outsider]) await client.user.create({ data: { id, name: id === member ? 'Alice' : 'Bob', email: `${id}@example.invalid`, passwordHash: 'unused' } });
    await client.group.create({ data: { id: groupId, code: generateId().replaceAll('-', '').slice(0, 12).toUpperCase(), name: 'Pockets', createdBy: owner, updatedBy: owner } });
    await client.userGroup.createMany({ data: [owner, member].map((userId) => ({ id: generateId(), userId, groupId, role: userId === owner ? 'OWNER' : 'MEMBER', createdBy: owner })) });
    const type = generateId(), parent = generateId(), child = generateId(), usd = generateId(), plain = generateId();
    await client.accountType.create({ data: { id: type, userId: member, name: 'Cash' } });
    await client.account.create({ data: { id: parent, userId: member, accountTypeId: type, name: 'Bank', balance: '999.00' } });
    await client.account.createMany({
        data: [
            { id: child, parentAccountId: parent, userId: member, accountTypeId: type, name: 'Holiday', balance: '9007199254740993.01' },
            { id: usd, userId: member, accountTypeId: type, name: 'Secondary', currency: 'IDR', balance: '-0.10' },
            { id: plain, userId: member, accountTypeId: type, name: 'Plain', balance: '0.09' },
        ]
    });
    const pocket = await repository.create(member, groupId, { name: 'Travel', description: 'Purpose, not transfer' });
    expect(pocket.accounts).toEqual([]);
    const other = await repository.create(owner, groupId, { name: 'Emergency' });
    await new PrismaGroupRepository(client).createCategory(member, groupId, { name: 'Travel', type: 'EXPENSE' });
    await expect(repository.read(outsider, groupId)).rejects.toMatchObject({ statusCode: 403 });
    await expect(repository.create(outsider, groupId, { name: 'No' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(repository.assign(owner, groupId, pocket.id, child, false)).rejects.toMatchObject({ statusCode: 403 });
    await expect(repository.assign(member, groupId, pocket.id, parent, false)).rejects.toMatchObject({ statusCode: 422 });
    await client.groupAccount.create({ data: { id: generateId(), groupId, accountId: plain } });
    for (const accountId of [child, usd, plain]) await repository.assign(member, groupId, pocket.id, accountId, false);
    await repository.assign(member, groupId, pocket.id, child, false);
    await expect(repository.assign(member, groupId, other.id, child, false)).rejects.toMatchObject({ statusCode: 409 });
    const result = await repository.read(owner, groupId);
    const travel = result.find((item) => item.id === pocket.id);
    expect(travel?.balances).toEqual([{ currency: 'IDR', balance: '9007199254740993.00' }]);
    expect(travel?.accounts).toContainEqual({ account_id: child, name: 'Bank - Holiday', owner_user_id: member, owner_name: 'Alice', currency: 'IDR', balance: '9007199254740993.01' });
    expect(Object.keys(travel?.accounts[0] ?? {}).sort()).toEqual(['account_id', 'balance', 'currency', 'name', 'owner_name', 'owner_user_id']);
    expect((await client.account.findUniqueOrThrow({ where: { id: child } })).balance.toFixed(2)).toBe('9007199254740993.01');
    await repository.assign(member, groupId, pocket.id, child, true);
    expect(await client.groupAccount.count({ where: { groupId, accountId: child } })).toBe(1);
    expect(await client.groupAccount.count({ where: { groupId, accountId: plain } })).toBe(1);
    await repository.assign(member, groupId, pocket.id, child, false);
    await client.groupAccount.deleteMany({ where: { groupId, accountId: child } });
    expect((await repository.read(owner, groupId)).find((item) => item.id === pocket.id)?.accounts.some((a) => a.account_id === child)).toBe(false);
    await repository.assign(member, groupId, pocket.id, child, false);
    // Defensive reads omit a linked account that later becomes a parent.
    await client.account.create({ data: { id: generateId(), parentAccountId: child, userId: member, accountTypeId: type, name: 'Nested' } });
    expect((await repository.read(owner, groupId)).find((item) => item.id === pocket.id)?.accounts.some((a) => a.account_id === child)).toBe(false);
    await repository.assign(member, groupId, pocket.id, child, true);
    await client.account.update({ where: { id: usd }, data: { deletedAt: new Date() } });
    expect((await repository.read(owner, groupId)).find((item) => item.id === pocket.id)?.balances).toEqual([{ currency: 'IDR', balance: '0.09' }]);
    await new CollaborationRepository(syncClient(client)).manage(owner, groupId, member, 'REMOVE');
    expect(await client.groupPocketAccount.count({ where: { groupId } })).toBe(0);
    await expect(repository.read(member, groupId)).rejects.toMatchObject({ statusCode: 403 });
    expect((await repository.read(owner, groupId)).every((item) => item.accounts.length === 0)).toBe(true);
});
