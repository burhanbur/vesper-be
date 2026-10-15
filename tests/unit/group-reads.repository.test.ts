import { afterEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/infrastructure/database/prisma.js';
import type { Prisma } from '../../src/generated/prisma/client.js';
import { PrismaGroupRepository } from '../../src/modules/groups/group.repository.js';

const actor = '019a0000-0000-7000-8000-000000000001';
const group = '019a0000-0000-7000-8000-000000000002';
const rowId = '019a0000-0000-7000-8000-000000000003';
const resource = '019a0000-0000-7000-8000-000000000004';
afterEach(() => vi.restoreAllMocks());

function fixture(member = true) {
    // Execute the real transaction callback against mocked persistence only; never connect to PostgreSQL.
    const membership = vi.spyOn(prisma.userGroup, 'findFirst').mockResolvedValue(member ? {
        id: rowId, userId: actor, groupId: group, role: 'MEMBER', createdBy: actor,
        createdAt: new Date(), updatedAt: new Date(),
    } : null);
    const accounts = vi.spyOn(prisma.groupAccount, 'findMany').mockResolvedValue([]);
    const accountCount = vi.spyOn(prisma.groupAccount, 'count').mockResolvedValue(0);
    const mappings = vi.spyOn(prisma.mappingGroupCategory, 'findMany').mockResolvedValue([]);
    const mappingCount = vi.spyOn(prisma.mappingGroupCategory, 'count').mockResolvedValue(0);
    const transaction = vi.spyOn(prisma, '$transaction').mockImplementation(async (callback) => {
        if (typeof callback !== 'function') throw new Error('Expected interactive transaction');
        return callback(prisma);
    });
    return { repository: new PrismaGroupRepository(prisma), membership, accounts, accountCount, mappings, mappingCount, transaction };
}

describe('group management reads', () => {
    it('selects only own active shared accounts with identical row/count filters and stable snapshot pagination', async () => {
        const f = fixture();
        const result = await f.repository.accounts(actor, group, { page: 3, limit: 2 });
        const where: Prisma.GroupAccountWhereInput = {
            groupId: group, account: { userId: actor, deletedAt: null, accountType: { userId: actor, deletedAt: null } },
        };
        expect(f.accounts).toHaveBeenCalledExactlyOnceWith({
            where,
            select: { id: true, groupId: true, accountId: true, account: { select: { name: true } } },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], skip: 4, take: 2,
        });
        expect(f.accountCount).toHaveBeenCalledExactlyOnceWith({ where });
        expect(f.membership).toHaveBeenCalledExactlyOnceWith({
            where: {
                groupId: group, userId: actor, user: { status: 'ACTIVE', deletedAt: null },
                group: { isActive: true, deletedAt: null },
            }, include: { group: true }
        });
        expect(f.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead' });
        expect(result).toEqual({ items: [], total: 0 });
    });

    it('filters own live matching-type personal mappings before pagination/counting', async () => {
        const f = fixture();
        await f.repository.categoryMappings(actor, group, { page: 2, limit: 5 });
        const where: Prisma.MappingGroupCategoryWhereInput = {
            groupId: group, userCategory: { userId: actor, deletedAt: null },
            OR: [
                { userCategory: { type: 'INCOME' }, groupCategory: { groupId: group, type: 'INCOME' } },
                { userCategory: { type: 'EXPENSE' }, groupCategory: { groupId: group, type: 'EXPENSE' } },
            ],
        };
        expect(f.mappings).toHaveBeenCalledExactlyOnceWith({
            where,
            select: { id: true, groupId: true, groupCategoryId: true, userCategoryId: true },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], skip: 5, take: 5,
        });
        expect(f.mappingCount).toHaveBeenCalledExactlyOnceWith({ where });
        expect(f.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead' });
    });

    it.each(['accounts', 'categoryMappings'] as const)('denies %s without active membership before reading/counting', async (method) => {
        const f = fixture(false);
        await expect(f.repository[method](actor, group, { page: 1, limit: 20 })).rejects.toMatchObject({ statusCode: 403, code: 'GROUP_ACCESS_DENIED' });
        for (const read of [f.accounts, f.accountCount, f.mappings, f.mappingCount]) expect(read).not.toHaveBeenCalled();
    });

    it('maps sharing/mapping row IDs and discards unselected or sensitive fields', async () => {
        const f = fixture();
        const dates = { createdAt: new Date(), updatedAt: new Date() };
        const sharing = { id: rowId, groupId: group, accountId: resource, ...dates, account: { name: 'Wallet', balance: '999.00', userId: actor } };
        const mapping = { id: rowId, groupId: group, groupCategoryId: resource, userCategoryId: actor, ...dates };
        f.accounts.mockResolvedValue([sharing]);
        f.mappings.mockResolvedValue([mapping]);
        expect((await f.repository.accounts(actor, group, { page: 1, limit: 20 })).items).toEqual([
            { id: rowId, group_id: group, account_id: resource, name: 'Wallet' },
        ]);
        expect((await f.repository.categoryMappings(actor, group, { page: 1, limit: 20 })).items).toEqual([
            { id: rowId, group_id: group, group_category_id: resource, user_category_id: actor },
        ]);
    });
});
