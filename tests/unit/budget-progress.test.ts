import { afterEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/infrastructure/database/prisma.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import {
    type BudgetRepository,
    PrismaBudgetRepository,
} from '../../src/modules/budgets/budget.repository.js';
import { BudgetService } from '../../src/modules/budgets/budget.service.js';
import type { BudgetRecord } from '../../src/modules/budgets/budget.types.js';

const userId = '019a0000-0000-7000-8000-000000000001';
const budgetId = '019a0000-0000-7000-8000-000000000002';
const categoryId = '019a0000-0000-7000-8000-000000000003';

afterEach(() => vi.restoreAllMocks());

function mockBudgetRecord(overrides?: Partial<BudgetRecord>): BudgetRecord {
    return {
        id: budgetId,
        categoryId,
        icon: 'food',
        anchorDate: new Date('2026-01-15T00:00:00.000Z'),
        periodType: 'MONTHLY',
        baseCurrency: 'IDR',
        description: 'Food & Dining',
        sequenceOrder: 1n,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        deletedAt: null,
        category: {
            id: categoryId,
            userId,
            name: 'Food',
            type: 'EXPENSE',
            version: 1n,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            deletedAt: null,
        },
        amounts: [
            {
                id: '019a0000-0000-7000-8000-000000000010',
                budgetId,
                amount: new Prisma.Decimal('1000000.00'),
                effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
                effectiveTo: null,
                createdAt: new Date('2026-01-01T00:00:00.000Z'),
                updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            },
        ],
        ...overrides,
    };
}

describe('Budget progress repository and service (WM-03)', () => {
    describe('PrismaBudgetRepository.progress', () => {
        it('queries transactions strictly within period boundaries, matching category, excluding transfers and deletions', async () => {
            const budget = mockBudgetRecord();
            const budgetFind = vi.spyOn(prisma.budget, 'findFirst').mockResolvedValue(budget);
            const amountsFind = vi
                .spyOn(prisma.budgetAmount, 'findMany')
                .mockResolvedValue(budget.amounts);
            const txAggregate = vi.spyOn(prisma.transaction, 'aggregate').mockResolvedValue({
                _sum: { amount: new Prisma.Decimal('350000.00') },
            } as unknown as Awaited<ReturnType<typeof prisma.transaction.aggregate>>);
            const transactionSpy = vi
                .spyOn(prisma, '$transaction')
                .mockImplementation(async (callback) => {
                    if (typeof callback !== 'function') throw new Error('Expected interactive transaction');
                    return callback(prisma);
                });

            const repo = new PrismaBudgetRepository(prisma);
            const result = await repo.progress(userId, budgetId, '2026-03');

            expect(budgetFind).toHaveBeenCalledWith({
                where: { id: budgetId, deletedAt: null, category: { userId, deletedAt: null } },
                include: { amounts: { where: { effectiveTo: null } }, category: true },
            });

            // Anchor day 15 in March 2026 -> 2026-03-15T00:00:00.000Z to 2026-04-15T00:00:00.000Z
            const expectedStart = new Date('2026-03-15T00:00:00.000Z');
            const expectedEnd = new Date('2026-04-15T00:00:00.000Z');

            expect(amountsFind).toHaveBeenCalledWith({
                where: {
                    budgetId,
                    effectiveFrom: { lt: expectedEnd },
                    OR: [{ effectiveTo: null }, { effectiveTo: { gt: expectedStart } }],
                },
                orderBy: [{ effectiveFrom: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
            });

            expect(txAggregate).toHaveBeenCalledWith({
                where: {
                    categoryId,
                    type: 'EXPENSE',
                    transferId: null,
                    deletedAt: null,
                    transactedAt: { gte: expectedStart, lt: expectedEnd },
                    account: {
                        userId,
                        deletedAt: null,
                        currency: 'IDR',
                        accountType: { userId, deletedAt: null },
                    },
                },
                _sum: { amount: true },
            });

            expect(transactionSpy).toHaveBeenCalledWith(expect.any(Function), {
                isolationLevel: 'RepeatableRead',
            });

            expect(result.start.toISOString()).toBe('2026-03-15T00:00:00.000Z');
            expect(result.end.toISOString()).toBe('2026-04-15T00:00:00.000Z');
            expect(result.total.toString()).toBe('350000');
        });

        it('throws BUDGET_PERIOD_INVALID when period format does not match period type', async () => {
            const budget = mockBudgetRecord();
            vi.spyOn(prisma.budget, 'findFirst').mockResolvedValue(budget);
            vi.spyOn(prisma, '$transaction').mockImplementation(async (callback) => {
                if (typeof callback !== 'function') throw new Error('Expected interactive transaction');
                return callback(prisma);
            });

            const repo = new PrismaBudgetRepository(prisma);

            await expect(repo.progress(userId, budgetId, 'invalid-period')).rejects.toThrow(
                expect.objectContaining({
                    code: 'BUDGET_PERIOD_INVALID',
                    statusCode: 422,
                }),
            );
        });

        it('throws BUDGET_NOT_FOUND when budget is missing, deleted, or belongs to another user', async () => {
            vi.spyOn(prisma.budget, 'findFirst').mockResolvedValue(null);
            vi.spyOn(prisma, '$transaction').mockImplementation(async (callback) => {
                if (typeof callback !== 'function') throw new Error('Expected interactive transaction');
                return callback(prisma);
            });

            const repo = new PrismaBudgetRepository(prisma);

            await expect(repo.progress(userId, budgetId, '2026-03')).rejects.toThrow(
                expect.objectContaining({
                    code: 'BUDGET_NOT_FOUND',
                    statusCode: 404,
                }),
            );
        });
    });

    describe('BudgetService.progress', () => {
        it('prorates allowance across mid-period budget amount changes', async () => {
            // 30-day period: 2026-04-01 to 2026-05-01 (anchor day 1)
            const start = new Date('2026-04-01T00:00:00.000Z');
            const mid = new Date('2026-04-16T00:00:00.000Z'); // 15 days in
            const end = new Date('2026-05-01T00:00:00.000Z'); // 30 days total

            const record = mockBudgetRecord({
                anchorDate: new Date('2026-01-01T00:00:00.000Z'),
                amounts: [
                    {
                        id: 'seg-1',
                        budgetId,
                        amount: new Prisma.Decimal('1000000.00'),
                        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
                        effectiveTo: mid,
                        createdAt: new Date('2026-01-01T00:00:00.000Z'),
                        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
                    },
                    {
                        id: 'seg-2',
                        budgetId,
                        amount: new Prisma.Decimal('2000000.00'),
                        effectiveFrom: mid,
                        effectiveTo: null,
                        createdAt: new Date('2026-04-16T00:00:00.000Z'),
                        updatedAt: new Date('2026-04-16T00:00:00.000Z'),
                    },
                ],
            });

            const mockRepo: BudgetRepository = {
                list: vi.fn(),
                create: vi.fn(),
                update: vi.fn(),
                softDelete: vi.fn(),
                progress: vi.fn().mockResolvedValue({
                    record,
                    start,
                    end,
                    total: new Prisma.Decimal('750000.00'),
                }),
            };

            const service = new BudgetService(mockRepo);
            const dto = await service.progress(userId, budgetId, '2026-04');

            // seg-1: 15 active days out of 30 -> 1000000 * 15 / 30 = 500000.00
            // seg-2: 15 active days out of 30 -> 2000000 * 15 / 30 = 1000000.00
            // Total allowance = 1500000.00
            expect(dto.period_days).toBe(30);
            expect(dto.allowance).toBe('1500000.00');
            expect(dto.total_amount).toBe('750000.00');
            expect(dto.remaining_amount).toBe('750000.00');
            // progress: 750000 / 1500000 * 100 = 50.00%
            expect(dto.progress_percent).toBe('50.00');
            expect(dto.budget_amounts).toHaveLength(2);
            expect(dto.budget_amounts[0]?.allowance).toBe('500000.00');
            expect(dto.budget_amounts[1]?.allowance).toBe('1000000.00');
        });

        it('returns null progress_percent when allowance is zero', async () => {
            const start = new Date('2026-04-01T00:00:00.000Z');
            const end = new Date('2026-05-01T00:00:00.000Z');

            const record = mockBudgetRecord({
                amounts: [
                    {
                        id: 'seg-zero',
                        budgetId,
                        amount: new Prisma.Decimal('0.00'),
                        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
                        effectiveTo: null,
                        createdAt: new Date('2026-01-01T00:00:00.000Z'),
                        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
                    },
                ],
            });

            const mockRepo: BudgetRepository = {
                list: vi.fn(),
                create: vi.fn(),
                update: vi.fn(),
                softDelete: vi.fn(),
                progress: vi.fn().mockResolvedValue({
                    record,
                    start,
                    end,
                    total: new Prisma.Decimal('100.00'),
                }),
            };

            const service = new BudgetService(mockRepo);
            const dto = await service.progress(userId, budgetId, '2026-04');

            expect(dto.allowance).toBe('0.00');
            expect(dto.progress_percent).toBeNull();
            expect(dto.remaining_amount).toBe('-100.00');
        });
    });
});
