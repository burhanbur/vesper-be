import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { integrationDatabaseUrl } from '../../src/config/integration-test.js';
import { generateId } from '../../src/common/utils/id.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { PrismaAccountRepository } from '../../src/modules/accounts/account.repository.js';
import {
    CreateAccountSchema,
    UpdateAccountSchema,
} from '../../src/modules/accounts/account.schema.js';
import { PrismaTransactionRepository } from '../../src/modules/transactions/transaction.repository.js';
import { CreateTransactionSchema } from '../../src/modules/transactions/transaction.schema.js';
import { PrismaTransferRepository } from '../../src/modules/transfers/transfer.repository.js';
import { toAccountDto } from '../../src/modules/accounts/account.types.js';
import { SyncRepository } from '../../src/modules/sync/sync.repository.js';
import { PushItemSchema } from '../../src/modules/sync/sync.schema.js';
import { PrismaGroupRepository } from '../../src/modules/groups/group.repository.js';
import { PrismaPocketRepository } from '../../src/modules/groups/pocket.repository.js';
import { PrismaDashboardRepository } from '../../src/modules/dashboard/dashboard.repository.js';
import { PrismaInvestmentRepository } from '../../src/modules/investments/investment.repository.js';
import { CreateInvestmentSchema } from '../../src/modules/investments/investment.schema.js';
import { PullQuerySchema } from '../../src/modules/sync/sync.schema.js';

const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: integrationDatabaseUrl() }),
});
const accounts = new PrismaAccountRepository(client);
const transactions = new PrismaTransactionRepository(client);
const transfers = new PrismaTransferRepository(client);
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
    const userId = generateId(),
        typeId = generateId(),
        categoryId = generateId(),
        deviceId = generateId();
    await client.user.create({
        data: {
            id: userId,
            name: 'Card test',
            email: `${userId}@example.invalid`,
            passwordHash: 'unused',
        },
    });
    await client.accountType.create({ data: { id: typeId, userId, name: 'Cash' } });
    await client.category.create({
        data: { id: categoryId, userId, name: 'Expense', type: 'EXPENSE' },
    });
    await client.device.create({
        data: { id: deviceId, userId, name: 'Test', platform: 'Android', appVersion: 'test' },
    });
    const card = await accounts.create(
        userId,
        generateId(),
        CreateAccountSchema.parse({
            account_type_id: typeId,
            name: 'Explicit card',
            is_credit_card: true,
            credit_limit: '1000000.23',
        }),
    );
    const bank = await accounts.create(
        userId,
        generateId(),
        CreateAccountSchema.parse({ account_type_id: typeId, name: 'Bank' }),
    );
    const expense = (amount: string) =>
        transactions.create(
            userId,
            generateId(),
            CreateTransactionSchema.parse({
                account_id: card.id,
                category_id: categoryId,
                type: 'EXPENSE',
                amount,
                transacted_at: '2026-11-06T00:00:00Z',
            }),
        );
    return { userId, typeId, categoryId, card, bank, expense, deviceId };
}
describe('simplified cards on isolated PostgreSQL', () => {
    it('rejects emergency reserves, goal allocations and obligation cash/mapping misuse through sync', async () => {
        const f = await fixture();
        const push = (entity: string, payload: object, id = generateId()) =>
            sync.apply(
                f.userId,
                f.deviceId,
                PushItemSchema.parse({
                    entity_type: entity,
                    entity_id: id,
                    operation: 'CREATE',
                    client_version: '0',
                    payload,
                }),
            );
        await expect(
            push('emergency_plans', {
                currency: 'IDR',
                baseline_mode: 'MANUAL',
                manual_baseline: '100.00',
                coverage_months: 6,
                history_months: 3,
                account_ids: [f.card.id],
                category_ids: [],
                goal_id: null,
            }),
        ).rejects.toMatchObject({ code: 'EMERGENCY_PLAN_REJECTED' });
        const goalId = generateId();
        expect(
            (
                await push(
                    'goals',
                    {
                        name: 'Goal',
                        currency: 'IDR',
                        target_amount: '100.00',
                        start_date: '2026-11-01',
                        target_date: '2027-11-01',
                        group_id: null,
                    },
                    goalId,
                )
            ).status,
        ).toBe('applied');
        await expect(
            push('goal_allocations', {
                goal_id: goalId,
                account_id: f.card.id,
                amount: '0.01',
            }),
        ).rejects.toThrow();
        for (const mapping of [false, true]) {
            await expect(
                push('obligation_commands', {
                    action: 'OPEN',
                    obligation_id: generateId(),
                    kind: 'PAYABLE',
                    counterparty: 'Lender',
                    currency: 'IDR',
                    principal: '0.23',
                    due_date: null,
                    installments: [],
                    cash_account_id: mapping ? null : f.card.id,
                    linked_account_id: mapping ? f.card.id : null,
                    ledger_ids: {
                        cash_principal: generateId(),
                        mapped_principal: generateId(),
                        interest: generateId(),
                        fee: generateId(),
                    },
                    transacted_at: '2026-11-06T00:00:00Z',
                }),
            ).rejects.toThrow();
        }
        expect(await client.obligation.count({ where: { userId: f.userId } })).toBe(0);
        expect(await client.transaction.count({ where: { accountId: f.card.id } })).toBe(0);
    });
    it('uses ordinary over-limit expenses, atomic replayable overpayments and subsequent credit consumption', async () => {
        const f = await fixture();
        expect(toAccountDto(f.card)).toMatchObject({
            balance: '0.00',
            is_credit_card: true,
            credit_limit: '1000000.23',
        });
        await f.expense('2000000.00');
        const payment = {
            from_account_id: f.bank.id,
            to_account_id: f.card.id,
            from_transaction_id: generateId(),
            to_transaction_id: generateId(),
            amount: '2500000.00',
            transacted_at: '2026-11-06T00:00:00Z',
            description: null,
        };
        const command = generateId();
        await transfers.createOffline(f.userId, command, payment);
        await transfers.createOffline(f.userId, command, payment);
        const balance = async () =>
            (await client.account.findUniqueOrThrow({ where: { id: f.card.id } })).balance.toFixed(2);
        expect(await balance()).toBe('500000.00');
        await f.expense('200000.00');
        expect(await balance()).toBe('300000.00');
        await f.expense('400000.00');
        expect(await balance()).toBe('-100000.00');
        const current = await client.account.findUniqueOrThrow({ where: { id: f.card.id } });
        const edited = await accounts.update(
            f.userId,
            f.card.id,
            UpdateAccountSchema.parse({ version: current.version.toString(), credit_limit: '0.01' }),
        );
        expect(edited.balance.toFixed(2)).toBe('-100000.00');
        const renamed = await accounts.update(
            f.userId,
            f.card.id,
            UpdateAccountSchema.parse({ version: edited.version.toString(), name: 'Old client rename' }),
        );
        expect(toAccountDto(renamed)).toMatchObject({ is_credit_card: true, credit_limit: '0.01' });
        await expect(
            accounts.update(
                f.userId,
                f.card.id,
                UpdateAccountSchema.parse({ version: renamed.version.toString(), is_credit_card: false }),
            ),
        ).rejects.toMatchObject({ code: 'ACCOUNT_CLASSIFICATION_LOCKED' });
        await expect(
            accounts.create(
                f.userId,
                generateId(),
                CreateAccountSchema.parse({
                    account_type_id: f.typeId,
                    parent_account_id: f.card.id,
                    name: 'Child',
                }),
            ),
        ).rejects.toMatchObject({ code: 'ACCOUNT_PARENT_INVALID' });
        const before = await balance();
        await expect(
            transfers.create(f.userId, generateId(), {
                ...payment,
                from_account_id: f.card.id,
                to_account_id: f.bank.id,
            }),
        ).rejects.toMatchObject({ code: 'CREDIT_CARD_USE_INVALID' });
        expect(await balance()).toBe(before);
        expect(await client.transfer.count({ where: { createdBy: f.userId } })).toBe(1);
        expect(await client.transaction.count({ where: { transferId: command } })).toBe(2);
        const totals = await new PrismaDashboardRepository(client).summarize(
            f.userId,
            new Date('2026-11-01'),
            new Date('2026-12-01'),
        );
        expect(totals.expense.toFixed(2)).toBe('2600000.00');
        expect(totals.income.toFixed(2)).toBe('0.00');
    });
    it('rejects group sharing and pocket assignment and excludes stale sharing from sync', async () => {
        const f = await fixture();
        const groupId = generateId();
        await client.group.create({
            data: {
                id: groupId,
                code: generateId().replaceAll('-', '').slice(0, 12).toUpperCase(),
                name: 'Private card test',
                createdBy: f.userId,
                updatedBy: f.userId,
            },
        });
        await client.userGroup.create({
            data: { id: generateId(), userId: f.userId, groupId, role: 'OWNER', createdBy: f.userId },
        });
        await expect(
            new PrismaGroupRepository(client).share(f.userId, groupId, f.card.id, false),
        ).rejects.toMatchObject({ code: 'GROUP_ACCESS_DENIED' });
        const pockets = new PrismaPocketRepository(client);
        const pocket = await pockets.create(f.userId, groupId, { name: 'Household' });
        await expect(
            pockets.assign(f.userId, groupId, pocket.id, f.card.id, false),
        ).rejects.toMatchObject({ code: 'GROUP_POCKET_ACCOUNT_INVALID' });
        const other = await fixture();
        await client.userGroup.create({
            data: {
                id: generateId(),
                userId: other.userId,
                groupId,
                role: 'MEMBER',
                createdBy: f.userId,
            },
        });
        // Simulate an inconsistent historical share: reads must still fail closed.
        await client.groupAccount.create({ data: { id: generateId(), groupId, accountId: f.card.id } });
        expect(await sync.data(client, other.userId, 'accounts', f.card.id)).toBeNull();
        await client.syncChange.create({
            data: {
                id: generateId(),
                userId: other.userId,
                entityType: 'accounts',
                entityId: f.card.id,
                operation: 'UPDATE',
            },
        });
        const page = await sync.pull(
            other.userId,
            PullQuerySchema.parse({
                device_id: other.deviceId,
                since_version: '0',
            }),
        );
        expect(page.changes.find((change) => change.entity_id === f.card.id)).toMatchObject({
            operation: 'DELETE',
            payload: null,
        });
        const investmentType = await client.accountType.create({
            data: { id: generateId(), userId: f.userId, name: 'Investments', category: 'INVESTMENT' },
        });
        const portfolio = await accounts.create(
            f.userId,
            generateId(),
            CreateAccountSchema.parse({
                account_type_id: investmentType.id,
                name: 'Portfolio',
            }),
        );
        const instrumentId = generateId();
        await client.instrument.create({
            data: {
                id: instrumentId,
                code: `CARD-${instrumentId.toUpperCase()}`,
                name: 'Asset',
                type: 'STOCK',
                currency: 'IDR',
            },
        });
        await expect(
            new PrismaInvestmentRepository(client).createTransaction(
                f.userId,
                CreateInvestmentSchema.parse({
                    account_id: portfolio.id,
                    cash_account_id: f.card.id,
                    instrument_id: instrumentId,
                    type: 'BUY',
                    quantity: '1',
                    price_per_unit: '0.23',
                    fee: '0.00',
                    transacted_at: '2026-11-06T00:00:00Z',
                }),
            ),
        ).rejects.toMatchObject({ code: 'INVESTMENT_CASH_ACCOUNT_INVALID' });
        await expect(
            accounts.create(
                f.userId,
                generateId(),
                CreateAccountSchema.parse({
                    account_type_id: investmentType.id,
                    name: 'Invalid',
                    is_credit_card: true,
                }),
            ),
        ).rejects.toMatchObject({ code: 'ACCOUNT_CREDIT_CARD_INVALID' });
    });
    it('round-trips exact fields through sync and preserves old-client omitted metadata', async () => {
        const f = await fixture();
        const version = 9007199254740993n;
        await client.account.update({ where: { id: f.card.id }, data: { version } });
        const result = await sync.apply(
            f.userId,
            f.deviceId,
            PushItemSchema.parse({
                entity_type: 'accounts',
                entity_id: f.card.id,
                operation: 'UPDATE',
                client_version: version.toString(),
                payload: { name: 'Sync rename' },
            }),
        );
        expect(JSON.stringify(result)).toContain('1000000.23');
        const row = await client.account.findUniqueOrThrow({ where: { id: f.card.id } });
        expect(toAccountDto(row)).toMatchObject({
            is_credit_card: true,
            credit_limit: '1000000.23',
            name: 'Sync rename',
        });
        const pulled = await sync.data(client, f.userId, 'accounts', f.card.id);
        expect(pulled).toMatchObject({
            credit_limit: '1000000.23',
            is_credit_card: true,
            version: (version + 1n).toString(),
        });
        const cleared = await sync.apply(
            f.userId,
            f.deviceId,
            PushItemSchema.parse({
                entity_type: 'accounts',
                entity_id: f.card.id,
                operation: 'UPDATE',
                client_version: (version + 1n).toString(),
                payload: { credit_limit: null },
            }),
        );
        expect(cleared.status).toBe('applied');
        expect(await sync.data(client, f.userId, 'accounts', f.card.id)).toMatchObject({
            credit_limit: null,
            is_credit_card: true,
        });
    });
    it('rolls back both payment legs when the card version is exhausted', async () => {
        const f = await fixture();
        await client.account.update({
            where: { id: f.card.id },
            data: { version: 9223372036854775807n },
        });
        const commandId = generateId();
        await expect(
            transfers.createOffline(f.userId, commandId, {
                from_account_id: f.bank.id,
                to_account_id: f.card.id,
                from_transaction_id: generateId(),
                to_transaction_id: generateId(),
                amount: '0.23',
                transacted_at: '2026-11-06T00:00:00Z',
                description: null,
            }),
        ).rejects.toMatchObject({ code: 'ACCOUNT_LEDGER_LIMIT' });
        expect(await client.transfer.count({ where: { id: commandId } })).toBe(0);
        expect(await client.transaction.count({ where: { transferId: commandId } })).toBe(0);
        for (const id of [f.bank.id, f.card.id]) {
            expect((await client.account.findUniqueOrThrow({ where: { id } })).balance.toFixed(2)).toBe(
                '0.00',
            );
        }
    });
    it('rejects income on online and sync paths without financial writes', async () => {
        const f = await fixture();
        const categoryId = generateId();
        await client.category.create({
            data: { id: categoryId, userId: f.userId, name: 'Income', type: 'INCOME' },
        });
        const payload = {
            account_id: f.card.id,
            category_id: categoryId,
            type: 'INCOME',
            amount: '0.23',
            transacted_at: '2026-11-06T00:00:00Z',
        };
        await expect(
            transactions.create(f.userId, generateId(), CreateTransactionSchema.parse(payload)),
        ).rejects.toMatchObject({ code: 'CREDIT_CARD_USE_INVALID' });
        await expect(
            sync.apply(
                f.userId,
                f.deviceId,
                PushItemSchema.parse({
                    entity_type: 'transactions',
                    entity_id: generateId(),
                    operation: 'CREATE',
                    client_version: '0',
                    payload,
                }),
            ),
        ).rejects.toMatchObject({ code: 'CREDIT_CARD_USE_INVALID' });
        expect(await client.transaction.count({ where: { accountId: f.card.id } })).toBe(0);
    });
    it('rejects bill creation and linking through an inconsistent historical card schedule', async () => {
        const f = await fixture();
        const billId = generateId();
        const payload = {
            title: 'Invalid card bill',
            transaction_type: 'EXPENSE',
            amount_type: 'FIXED',
            amount: '0.23',
            account_id: f.card.id,
            category_id: f.categoryId,
            obligation_id: null,
            frequency: 'MONTHLY',
            anchor_date: '2026-01-01',
            end_date: null,
            utc_offset_minutes: 420,
            reminder_enabled: false,
            reminder_days: 0,
        };
        await expect(
            sync.apply(
                f.userId,
                f.deviceId,
                PushItemSchema.parse({
                    entity_type: 'bill_schedules',
                    entity_id: billId,
                    operation: 'CREATE',
                    client_version: '0',
                    payload,
                }),
            ),
        ).rejects.toThrow();
        await sync.apply(
            f.userId,
            f.deviceId,
            PushItemSchema.parse({
                entity_type: 'bill_schedules',
                entity_id: billId,
                operation: 'CREATE',
                client_version: '0',
                payload: { ...payload, account_id: f.bank.id },
            }),
        );
        // Historical/corrupt schedules must not bypass the account guard via LINK_TRANSACTION.
        await client.billSchedule.update({ where: { id: billId }, data: { accountId: f.card.id } });
        const expense = await f.expense('0.23');
        await expect(
            sync.apply(
                f.userId,
                f.deviceId,
                PushItemSchema.parse({
                    entity_type: 'bill_commands',
                    entity_id: generateId(),
                    operation: 'CREATE',
                    client_version: '0',
                    payload: {
                        bill_id: billId,
                        due_date: '2026-11-01',
                        action: 'LINK_TRANSACTION',
                        expected_version: '0',
                        amount: null,
                        record_id: expense.id,
                        ledger_id: generateId(),
                        transacted_at: '2026-11-06T00:00:00Z',
                        note: '',
                    },
                }),
            ),
        ).rejects.toThrow();
        expect(await client.billOccurrence.count({ where: { billId } })).toBe(0);
    });
});
