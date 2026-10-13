import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { Prisma, type PrismaClient } from '../../src/generated/prisma/client.js';
import { PrismaTransactionRepository } from '../../src/modules/transactions/transaction.repository.js';
import { registerTransactionOpenApi } from '../../src/modules/transactions/transaction.openapi.js';
import { BatchCreateTransactionsSchema } from '../../src/modules/transactions/transaction.schema.js';

const ledger = vi.hoisted(() => ({ lock: vi.fn(), recompute: vi.fn() }));
vi.mock('../../src/modules/transactions/ledger.js', () => ({
    lockLedgerAccounts: ledger.lock,
    recomputeLedgerBalances: ledger.recompute,
}));

const actor = 'importing-member';
const owner = 'account-type-owner';
const accountId = '019a4fff-7000-7000-8000-000000000002';
const categoryId = '019a4fff-7000-7000-8000-000000000003';
const secondCategoryId = '019a4fff-7000-7000-8000-000000000004';
const item = {
    type: 'EXPENSE' as const,
    account_id: accountId,
    category_id: categoryId,
    amount: '15000.00',
    transacted_at: '2026-10-04T10:00:00.000Z',
    description: null,
};

function harness(categories = [{ id: categoryId, userId: owner, type: 'EXPENSE' }]) {
    const tx = {
        $queryRaw: vi
            .fn<(strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>>()
            .mockResolvedValue([]),
        accountType: {
            findMany: vi.fn().mockResolvedValue([{ id: 'account-type', userId: owner }]),
        },
        category: { findMany: vi.fn().mockResolvedValue(categories) },
        transaction: {
            createMany: vi
                .fn<(input: { data: Prisma.TransactionCreateManyInput[] }) => Promise<{ count: number }>>()
                .mockResolvedValue({ count: 1 }),
        },
        transfer: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    // Verified test boundary: only the delegates above are used; no real client or connection exists.
    const client = {
        $transaction: vi.fn(async (operation: (client: Prisma.TransactionClient) => Promise<unknown>) =>
            operation(tx as unknown as Prisma.TransactionClient),
        ),
    } as unknown as PrismaClient;
    ledger.lock.mockResolvedValue([
        {
            id: accountId,
            accountTypeId: 'account-type',
            userId: 'different-account-owner',
            currency: 'IDR',
        },
    ]);
    ledger.recompute.mockResolvedValue(undefined);
    return { tx, repository: new PrismaTransactionRepository(client) };
}

beforeEach(() => vi.clearAllMocks());

describe('batch transaction category authorization (database-free)', () => {
    it('allows an accessible shared account with its account-type owner category, not actor/account owner', async () => {
        const { tx, repository } = harness();
        await expect(repository.createBatch(actor, [item])).resolves.toEqual({ count: 1 });
        expect(tx.accountType.findMany).toHaveBeenCalledWith({
            where: { id: { in: ['account-type'] }, deletedAt: null },
            select: { id: true, userId: true },
        });
        expect(tx.transaction.createMany).toHaveBeenCalledWith({
            data: [
                expect.objectContaining({ categoryId, accountId, createdBy: actor, updatedBy: actor }),
            ],
        });
        expect(ledger.recompute).toHaveBeenCalledOnce();
    });

    it.each([actor, 'unrelated-owner'])(
        'rejects a category owned by %s before any writes',
        async (userId) => {
            const { tx, repository } = harness([{ id: categoryId, userId, type: 'EXPENSE' }]);
            await expect(repository.createBatch(actor, [item])).rejects.toMatchObject({
                statusCode: 422,
                code: 'TRANSACTION_CATEGORY_INVALID',
            });
            expect(tx.transaction.createMany).not.toHaveBeenCalled();
            expect(tx.transfer.createMany).not.toHaveBeenCalled();
            expect(ledger.recompute).not.toHaveBeenCalled();
        },
    );

    it.each(['missing/deleted', 'wrong type'])(
        'rejects %s categories before writing the batch',
        async (scenario) => {
            const { tx, repository } = harness(
                scenario === 'wrong type' ? [{ id: categoryId, userId: owner, type: 'INCOME' }] : [],
            );
            await expect(repository.createBatch(actor, [item])).rejects.toMatchObject({
                statusCode: 422,
                code: 'TRANSACTION_CATEGORY_INVALID',
            });
            expect(tx.category.findMany).toHaveBeenCalledWith({
                where: { id: { in: [categoryId] }, deletedAt: null },
            });
            expect(tx.transaction.createMany).not.toHaveBeenCalled();
            expect(ledger.recompute).not.toHaveBeenCalled();
        },
    );

    it('locks deduplicated categories in sorted order after accounts and before active-category reads', async () => {
        const { tx, repository } = harness([
            { id: categoryId, userId: owner, type: 'EXPENSE' },
            { id: secondCategoryId, userId: owner, type: 'EXPENSE' },
        ]);
        await repository.createBatch(actor, [{ ...item, category_id: secondCategoryId }, item, item]);
        expect(tx.$queryRaw.mock.calls).toHaveLength(2);
        expect(tx.$queryRaw.mock.calls[0]?.[1]).toBe(categoryId);
        expect(tx.$queryRaw.mock.calls[1]?.[1]).toBe(secondCategoryId);
        expect(tx.$queryRaw.mock.calls[0]?.[0].join('')).toContain('FOR UPDATE');
        expect(ledger.lock.mock.invocationCallOrder[0]).toBeLessThan(
            tx.$queryRaw.mock.invocationCallOrder[0] ?? 0,
        );
        expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
            tx.category.findMany.mock.invocationCallOrder[0] ?? 0,
        );
    });

    it('checks category ownership separately for every target account type and rejects the entire batch', async () => {
        const { tx, repository } = harness();
        ledger.lock.mockResolvedValue([
            { id: accountId, accountTypeId: 'account-type', currency: 'IDR' },
            { id: 'second-account', accountTypeId: 'second-type', currency: 'IDR' },
        ]);
        tx.accountType.findMany.mockResolvedValue([
            { id: 'account-type', userId: owner },
            { id: 'second-type', userId: 'second-owner' },
        ]);
        await expect(
            repository.createBatch(actor, [item, { ...item, account_id: 'second-account' }]),
        ).rejects.toMatchObject({ code: 'TRANSACTION_CATEGORY_INVALID' });
        expect(tx.transaction.createMany).not.toHaveBeenCalled();
        expect(ledger.recompute).not.toHaveBeenCalled();
    });

    it('does not read categories or write when account authorization/locking fails', async () => {
        const { tx, repository } = harness();
        const failure = new Error('Account lock rejected');
        ledger.lock.mockRejectedValue(failure);
        await expect(repository.createBatch(actor, [item])).rejects.toBe(failure);
        expect(tx.$queryRaw).not.toHaveBeenCalled();
        expect(tx.category.findMany).not.toHaveBeenCalled();
        expect(tx.transaction.createMany).not.toHaveBeenCalled();
        expect(ledger.recompute).not.toHaveBeenCalled();
    });

    it('rejects a missing active account-type owner before writes', async () => {
        const { tx, repository } = harness();
        tx.accountType.findMany.mockResolvedValue([]);
        await expect(repository.createBatch(actor, [item])).rejects.toMatchObject({
            statusCode: 422,
            code: 'TRANSACTION_ACCOUNT_INVALID',
        });
        expect(tx.transaction.createMany).not.toHaveBeenCalled();
        expect(ledger.recompute).not.toHaveBeenCalled();
    });

    it('writes a transfer and two signed ledger legs but counts only input entries', async () => {
        const { tx, repository } = harness();
        const toAccountId = '019a4fff-7000-7000-8000-000000000005';
        ledger.lock.mockResolvedValue([
            { id: accountId, accountTypeId: 'account-type', currency: 'IDR' },
            { id: toAccountId, accountTypeId: 'account-type', currency: 'IDR' },
        ]);
        await expect(
            repository.createBatch(actor, [
                {
                    type: 'TRANSFER',
                    from_account_id: accountId,
                    to_account_id: toAccountId,
                    amount: '15000.00',
                    transacted_at: item.transacted_at,
                    description: null,
                },
            ]),
        ).resolves.toEqual({ count: 1 });
        expect(tx.transfer.createMany).toHaveBeenCalledWith({
            data: [expect.objectContaining({ fromAccountId: accountId, toAccountId, createdBy: actor })],
        });
        expect(tx.transaction.createMany).toHaveBeenCalledWith({
            data: [
                expect.objectContaining({ accountId, categoryId: null, type: 'TRANSFER' }),
                expect.objectContaining({ accountId: toAccountId, categoryId: null, type: 'TRANSFER' }),
            ],
        });
        const rows = tx.transaction.createMany.mock.calls[0]?.[0];
        const fromAmount = rows?.data[0]?.amount;
        const toAmount = rows?.data[1]?.amount;
        expect(fromAmount instanceof Prisma.Decimal && fromAmount.toFixed(2)).toBe('-15000.00');
        expect(toAmount instanceof Prisma.Decimal && toAmount.toFixed(2)).toBe('15000.00');
        expect(rows?.data[0]?.transferId).toBe(rows?.data[1]?.transferId);
        expect(tx.transfer.createMany.mock.invocationCallOrder[0]).toBeLessThan(
            tx.transaction.createMany.mock.invocationCallOrder[0] ?? 0,
        );
        expect(ledger.recompute).toHaveBeenCalledOnce();
    });
});

describe('batch OpenAPI contract', () => {
    it('registers the authenticated batch path with the existing success and error responses', () => {
        const registry = new OpenAPIRegistry();
        registerTransactionOpenApi(registry);
        const document = new OpenApiGeneratorV31(registry.definitions).generateDocument({
            openapi: '3.1.0',
            info: { title: 'Test', version: '1' },
        });
        const operation = document.paths?.['/api/v1/transactions/batch']?.post;
        expect(operation?.operationId).toBe('createBatchTransactions');
        expect(operation?.security).toEqual([{ bearerAuth: [] }]);
        expect(Object.keys(operation?.responses ?? {}).sort()).toEqual([
            '201',
            '400',
            '401',
            '409',
            '422',
            '429',
            '500',
        ]);
        expect(operation?.responses?.['201']).toMatchObject({
            content: {
                'application/json': {
                    example: { total_data: 1, data: { count: 1 }, message: '1 transaksi berhasil diimpor.' },
                },
            },
        });
        expect(BatchCreateTransactionsSchema.safeParse({ items: [item] }).success).toBe(true);
        expect(BatchCreateTransactionsSchema.safeParse({ items: [] }).success).toBe(false);
        expect(
            BatchCreateTransactionsSchema.safeParse({ items: Array.from({ length: 1001 }, () => item) })
                .success,
        ).toBe(false);
    });
});
