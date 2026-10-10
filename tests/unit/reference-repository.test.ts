import { afterEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/infrastructure/database/prisma.js';
import { PrismaReferenceRepository } from '../../src/modules/references/reference.repository.js';

// Mock every persistence boundary before invoking the real repository; no database connection.
afterEach(() => vi.restoreAllMocks());

describe('PrismaReferenceRepository', () => {
    it('reads only reference categories with shared filters/counts and stable ascending order', async () => {
        const find = vi.spyOn(prisma.refCategory, 'findMany').mockResolvedValue([]);
        const count = vi.spyOn(prisma.refCategory, 'count').mockResolvedValue(0);
        const transaction = vi.spyOn(prisma, '$transaction').mockResolvedValue([[], 0]);
        const owned = vi.spyOn(prisma.category, 'findMany');
        const result = await new PrismaReferenceRepository(prisma).listCategories({ page: 3, limit: 2, sort: 'name', name: 'Gaji', type: 'INCOME' });
        const where = { name: { contains: 'Gaji', mode: 'insensitive' }, type: 'INCOME' };
        expect(find).toHaveBeenCalledWith({ where, skip: 4, take: 2, orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { id: true, name: true, type: true, createdAt: true, updatedAt: true } });
        expect(count).toHaveBeenCalledWith({ where });
        expect(transaction).toHaveBeenCalledWith(expect.any(Array), { isolationLevel: 'RepeatableRead' });
        expect(owned).not.toHaveBeenCalled();
        expect(result).toEqual({ items: [], total: 0 });
    });

    it.each(['created_at', '-created_at', 'name', '-name'] as const)('reads only reference account types with %s sorting', async (sort) => {
        const find = vi.spyOn(prisma.refAccountType, 'findMany').mockResolvedValue([]);
        const count = vi.spyOn(prisma.refAccountType, 'count').mockResolvedValue(0);
        vi.spyOn(prisma, '$transaction').mockResolvedValue([[], 0]);
        const owned = vi.spyOn(prisma.accountType, 'findMany');
        await new PrismaReferenceRepository(prisma).listAccountTypes({ page: 1, limit: 20, sort });
        const direction = sort.startsWith('-') ? 'desc' : 'asc';
        expect(find).toHaveBeenCalledWith({ where: {}, skip: 0, take: 20, orderBy: [sort.endsWith('name') ? { name: direction } : { createdAt: direction }, { id: direction }], select: { id: true, name: true, createdAt: true, updatedAt: true } });
        expect(count).toHaveBeenCalledWith({ where: {} });
        expect(owned).not.toHaveBeenCalled();
    });

    it('uses the same name filter for account-type rows and count', async () => {
        const find = vi.spyOn(prisma.refAccountType, 'findMany').mockResolvedValue([]);
        const count = vi.spyOn(prisma.refAccountType, 'count').mockResolvedValue(0);
        vi.spyOn(prisma, '$transaction').mockResolvedValue([[], 0]);
        await new PrismaReferenceRepository(prisma).listAccountTypes({ page: 2, limit: 5, sort: '-name', name: 'Bank' });
        const where = { name: { contains: 'Bank', mode: 'insensitive' } };
        expect(find).toHaveBeenCalledWith(expect.objectContaining({ where, skip: 5, take: 5 }));
        expect(count).toHaveBeenCalledWith({ where });
    });
});
