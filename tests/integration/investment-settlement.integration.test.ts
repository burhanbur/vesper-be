import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { integrationDatabaseUrl } from '../../src/config/integration-test.js';
import { generateId } from '../../src/common/utils/id.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { PrismaInvestmentRepository } from '../../src/modules/investments/investment.repository.js';
import { CreateInvestmentSchema } from '../../src/modules/investments/investment.schema.js';
import { SyncRepository } from '../../src/modules/sync/sync.repository.js';
import { PushItemSchema } from '../../src/modules/sync/sync.schema.js';
import { syncClient } from '../../src/infrastructure/database/sync-publication.js';

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: integrationDatabaseUrl() }) });
const repository = new PrismaInvestmentRepository(client);

async function fixture() {
    const userId = generateId();
    await client.user.create({ data: { id: userId, name: 'Investment integration', email: `${userId}@example.invalid`, passwordHash: 'unused-test-fixture' } });
    const cashType = generateId();
    const investmentType = generateId();
    await client.accountType.createMany({
        data: [
            { id: cashType, userId, name: 'Cash', category: 'CASH' },
            { id: investmentType, userId, name: 'Investments', category: 'INVESTMENT' },
        ]
    });
    const cashId = generateId();
    const accountId = generateId();
    await client.account.createMany({
        data: [
            { id: cashId, userId, accountTypeId: cashType, name: 'Settlement cash' },
            { id: accountId, userId, accountTypeId: investmentType, name: 'Portfolio' },
        ]
    });
    const instrumentId = generateId();
    await client.instrument.create({ data: { id: instrumentId, code: `IT-${instrumentId.toUpperCase()}`, name: 'Test asset', type: 'STOCK', currency: 'IDR' } });
    const input = CreateInvestmentSchema.parse({ instrument_id: instrumentId, account_id: accountId, cash_account_id: cashId, type: 'BUY', quantity: '2', price_per_unit: '10.25', fee: '0.50', transacted_at: '2026-10-15T10:00:00.000Z' });
    return { userId, cashId, accountId, instrumentId, input };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function persisted(f: Fixture) {
    return {
        accounts: await client.account.findMany({ where: { userId: f.userId }, orderBy: { id: 'asc' } }),
        trades: await client.investmentTransaction.findMany({ where: { accountId: f.accountId }, orderBy: { id: 'asc' } }),
        ledger: await client.transaction.findMany({ where: { accountId: f.cashId }, orderBy: { id: 'asc' } }),
        holdings: await repository.holdings(f.userId, f.accountId),
    };
}
beforeAll(async () => {
    expect(await client.$queryRaw`SELECT current_database() AS database, current_user AS username`).toEqual([{ database: 'vesper_integration_test', username: 'vesper_integration' }]);
});
afterAll(async () => { await client.$disconnect(); });

describe('investment settlement on isolated PostgreSQL', () => {
    it('publishes a sync command atomically and replays across devices without new events', async () => {
        const f = await fixture();
        const devices = [generateId(), generateId()];
        await client.device.createMany({ data: devices.map((id) => ({ id, userId: f.userId, platform: 'Android', name: 'Integration', appVersion: '1.0.0' })) });
        const device = devices[0];
        const second = devices[1];
        if (!device || !second) throw new Error('Missing fixture devices');
        const item = PushItemSchema.parse({ entity_type: 'investment_transactions', entity_id: generateId(), operation: 'CREATE', client_version: '0', payload: { ...f.input, linked_transaction_id: generateId() } });
        const sync = new SyncRepository(client);
        const results = await Promise.all([sync.apply(f.userId, device, item), sync.apply(f.userId, second, item)]);
        expect(results.map((result) => result.status)).toEqual(['applied', 'applied']);
        const events = await client.syncChange.findMany({ where: { userId: f.userId } });
        expect(events.filter((event) => event.entityType === 'investment_transactions')).toHaveLength(1);
        expect(events.filter((event) => event.entityType === 'transactions')).toHaveLength(1);
        const page = await sync.pull(f.userId, { device_id: device, since_version: '0', limit: 100 });
        expect(page.changes.find((change) => change.entity_type === 'investment_transactions')?.payload?.id).toBe(item.entity_id);
        expect(page.changes.find((change) => change.entity_type === 'transactions')?.payload?.amount).toBe('21.00');
        await sync.apply(f.userId, second, item);
        expect(await client.syncChange.findMany({ where: { userId: f.userId } })).toEqual(events);
        expect((await persisted(f)).ledger).toHaveLength(1);
        const stranger = await fixture();
        const trade = await client.investmentTransaction.findUniqueOrThrow({ where: { id: item.entity_id } });
        if (!trade.linkedTransactionId) throw new Error('Missing settlement ledger');
        expect(await client.$transaction((tx) => sync.data(tx, stranger.userId, 'investment_transactions', trade.id))).toBeNull();
        expect(await client.$transaction((tx) => sync.data(tx, stranger.userId, 'transactions', trade.linkedTransactionId ?? ''))).toBeNull();
        await client.account.update({ where: { id: f.cashId }, data: { deletedAt: new Date() } });
        expect(await client.$transaction((tx) => sync.data(tx, f.userId, 'transactions', trade.linkedTransactionId ?? ''))).toBeNull();
        // Revoking the cash account does not hide a separately authorized portfolio trade.
        expect(await client.$transaction((tx) => sync.data(tx, f.userId, 'investment_transactions', trade.id))).not.toBeNull();
        await expect(sync.apply(f.userId, device, item)).rejects.toThrow();
        expect(await client.syncChange.findMany({ where: { userId: f.userId } })).toEqual(events);
    });

    it('publishes portfolio grants and revocations without leaking the separate cash ledger', async () => {
        const f = await fixture();
        const member = await fixture();
        const trade = await repository.createTransaction(f.userId, f.input);
        const groupId = generateId();
        await client.group.create({ data: { id: groupId, code: generateId().replaceAll('-', '').slice(-12).toUpperCase(), name: 'Portfolio sharing', createdBy: f.userId, updatedBy: f.userId } });
        await client.userGroup.createMany({
            data: [
                { id: generateId(), userId: f.userId, groupId, role: 'OWNER', createdBy: f.userId },
                { id: generateId(), userId: member.userId, groupId, role: 'MEMBER', createdBy: f.userId },
            ]
        });
        const shareId = generateId();
        const observed = syncClient(client);
        await observed.$transaction(async (tx) => {
            await tx.groupAccount.create({ data: { id: shareId, groupId, accountId: f.accountId } });
        });
        const sync = new SyncRepository(client);
        expect(await client.$transaction((tx) => sync.data(tx, member.userId, 'investment_transactions', trade.id))).not.toBeNull();
        expect(await client.$transaction((tx) => sync.data(tx, member.userId, 'transactions', trade.linkedTransactionId ?? ''))).toBeNull();
        const granted = await client.syncChange.findMany({ where: { userId: member.userId, entityType: 'investment_transactions', entityId: trade.id } });
        expect(granted.map((event) => event.operation)).toEqual(['CREATE']);
        await observed.$transaction(async (tx) => {
            await tx.groupAccount.delete({ where: { id: shareId } });
        });
        expect(await client.$transaction((tx) => sync.data(tx, member.userId, 'investment_transactions', trade.id))).toBeNull();
        const revoked = await client.syncChange.findMany({ where: { userId: member.userId, entityType: 'investment_transactions', entityId: trade.id }, orderBy: { version: 'asc' } });
        expect(revoked.map((event) => event.operation)).toEqual(['CREATE', 'DELETE']);
    });

    it('replays durable client UUID commands concurrently without duplicate cash or position changes', async () => {
        const f = await fixture();
        const id = generateId();
        const legId = generateId();
        const results = await Promise.all(Array.from({ length: 3 }, () => repository.createOffline(f.userId, id, legId, f.input)));
        expect(results.map((row) => row.id)).toEqual([id, id, id]);
        const before = await persisted(f);
        expect(before.trades).toHaveLength(1);
        expect(before.ledger).toHaveLength(1);
        await repository.createOffline(f.userId, id, legId, { ...f.input, quantity: '2.00000000', fee: '0.5' });
        expect(await persisted(f)).toEqual(before);
        await expect(repository.createOffline(f.userId, id, legId, { ...f.input, quantity: '3' })).rejects.toMatchObject({ code: 'INVESTMENT_COMMAND_CONFLICT' });
        await expect(repository.createOffline(f.userId, id, generateId(), f.input)).rejects.toMatchObject({ code: 'INVESTMENT_COMMAND_CONFLICT' });
        expect(await persisted(f)).toEqual(before);
    });

    it('settles exact buy and sell cash without treating portfolio value as cash', async () => {
        const f = await fixture();
        const buy = await repository.createTransaction(f.userId, f.input);
        expect(buy.linkedTransactionId).not.toBeNull();
        let state = await persisted(f);
        // Cash ledger stores positive magnitude; EXPENSE supplies its balance sign.
        expect(state.ledger.map((row) => row.amount.toString())).toEqual(['21']);
        expect(state.ledger[0]?.type).toBe('EXPENSE');
        expect(state.accounts.find((row) => row.id === f.cashId)?.balance.toString()).toBe('-21');
        expect(state.accounts.find((row) => row.id === f.accountId)?.balance.toString()).toBe('0');
        expect(state.holdings[0]?.quantity_held).toBe('2.00000000');
        await repository.createTransaction(f.userId, { ...f.input, type: 'SELL', quantity: '1', price_per_unit: '12.75', fee: '0.25', transacted_at: '2026-10-15T10:00:01.000Z' });
        state = await persisted(f);
        expect(state.accounts.find((row) => row.id === f.cashId)?.balance.toString()).toBe('-8.5');
        expect(state.holdings[0]?.quantity_held).toBe('1.00000000');
        expect(state.trades).toHaveLength(2);
        expect(state.ledger).toHaveLength(2);
    });

    it('replays an old command after later trades without reapplying its position or cash', async () => {
        const f = await fixture();
        const id = generateId();
        const legId = generateId();
        await repository.createOffline(f.userId, id, legId, f.input);
        await repository.createTransaction(f.userId, { ...f.input, type: 'SELL', quantity: '1', transacted_at: '2026-10-15T10:00:01.000Z' });
        const before = await persisted(f);
        expect((await repository.createOffline(f.userId, id, legId, f.input)).id).toBe(id);
        expect(await persisted(f)).toEqual(before);
    });

    it('rejects replay after cash access is revoked without rewriting the command', async () => {
        const f = await fixture();
        const id = generateId();
        const legId = generateId();
        await repository.createOffline(f.userId, id, legId, f.input);
        await client.account.update({ where: { id: f.cashId }, data: { deletedAt: new Date() } });
        const before = await persisted(f);
        await expect(repository.createOffline(f.userId, id, legId, f.input)).rejects.toThrow();
        expect(await persisted(f)).toEqual(before);
    });

    it('rolls back a new command when its cash ledger UUID belongs to another trade', async () => {
        const f = await fixture();
        const legId = generateId();
        await repository.createOffline(f.userId, generateId(), legId, f.input);
        const before = await persisted(f);
        await expect(repository.createOffline(f.userId, generateId(), legId, { ...f.input, transacted_at: '2026-10-15T10:00:01.000Z' })).rejects.toMatchObject({ code: 'P2002' });
        expect(await persisted(f)).toEqual(before);
    });

    it('rejects overselling and leaves all persisted financial state unchanged', async () => {
        const f = await fixture();
        await repository.createTransaction(f.userId, f.input);
        const before = await persisted(f);
        await expect(repository.createTransaction(f.userId, { ...f.input, type: 'SELL', quantity: '3', transacted_at: '2026-10-15T10:00:01.000Z' })).rejects.toThrow();
        expect(await persisted(f)).toEqual(before);
    });

    it('rolls back trade and cash ledger when account balance version is exhausted', async () => {
        const f = await fixture();
        await client.account.update({ where: { id: f.cashId }, data: { version: 9223372036854775807n } });
        const before = await persisted(f);
        await expect(repository.createTransaction(f.userId, f.input)).rejects.toMatchObject({ code: 'ACCOUNT_LEDGER_LIMIT' });
        expect(await persisted(f)).toEqual(before);
    });

    it('serializes duplicate timestamps so concurrent submissions cannot settle twice', async () => {
        const f = await fixture();
        const results = await Promise.allSettled([repository.createTransaction(f.userId, f.input), repository.createTransaction(f.userId, f.input)]);
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        const state = await persisted(f);
        expect(state.trades).toHaveLength(1);
        expect(state.ledger).toHaveLength(1);
        expect(state.accounts.find((row) => row.id === f.cashId)?.balance.toString()).toBe('-21');
    });
});
