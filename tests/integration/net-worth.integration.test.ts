import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { integrationDatabaseUrl } from '../../src/config/integration-test.js';
import { generateId } from '../../src/common/utils/id.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { PrismaNetWorthRepository } from '../../src/modules/net-worth/net-worth.repository.js';
import { NetWorthService } from '../../src/modules/net-worth/net-worth.service.js';

const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: integrationDatabaseUrl() }),
});
const repository = new PrismaNetWorthRepository(client);
const observed = new Date('2026-10-20T10:00:00.000Z');
const tomorrow = new Date('2026-10-21T10:00:00.000Z');
const current = () => new NetWorthService(repository, () => observed);
const historical = () => new NetWorthService(new PrismaNetWorthRepository(client), () => tomorrow);
async function fixture() {
    const userId = generateId();
    await client.user.create({
        data: {
            id: userId,
            name: 'Observation test',
            email: `${userId}@example.invalid`,
            passwordHash: 'unused',
        },
    });
    const typeId = generateId();
    await client.accountType.create({ data: { id: typeId, userId, name: 'Cash', category: 'CASH' } });
    const accountId = generateId();
    await client.account.create({
        data: { id: accountId, userId, accountTypeId: typeId, name: 'Cash', balance: '123.45' },
    });
    return { userId, accountId };
}
beforeAll(async () => {
    expect(
        await client.$queryRaw`SELECT current_database() AS database, current_user AS username`,
    ).toEqual([{ database: 'vesper_integration_test', username: 'vesper_integration' }]);
});
afterAll(async () => {
    await client.$disconnect();
});

describe('durable owner net-worth observations on isolated PostgreSQL', () => {
    it('persists the exact first DTO, retains old eligibility/balances and never creates financial writes', async () => {
        const f = await fixture();
        const before = await client.account.findUniqueOrThrow({ where: { id: f.accountId } });
        const live = await current().snapshot(f.userId, { currency: 'IDR' });
        expect(live).toMatchObject({
            balance_basis: 'current_recorded_ledger',
            known_net_worth: '123.45',
            net_worth: null,
        });
        expect(await client.account.findUniqueOrThrow({ where: { id: f.accountId } })).toEqual(before);
        expect(await client.transaction.count({ where: { accountId: f.accountId } })).toBe(0);
        expect(await client.investmentTransaction.count({ where: { accountId: f.accountId } })).toBe(0);
        expect(await client.syncChange.count({ where: { userId: f.userId } })).toBe(0);
        await client.account.update({ where: { id: f.accountId }, data: { balance: '999.00' } });
        expect((await current().snapshot(f.userId, { currency: 'IDR' })).known_net_worth).toBe(
            '999.00',
        );
        await client.account.update({ where: { id: f.accountId }, data: { deletedAt: tomorrow } });
        const expected = { ...live, balance_basis: 'captured_recorded_ledger' };
        expect(await historical().snapshot(f.userId, { currency: 'IDR', date: '2026-10-20' })).toEqual(
            expected,
        );
        const row = await client.netWorthObservation.findFirstOrThrow({ where: { userId: f.userId } });
        expect(row.payload).toEqual(expected);
        expect(row.observedAt).toEqual(observed);
        expect(row.snapshotDate).toEqual(new Date('2026-10-20'));
        expect(await client.netWorthObservation.count({ where: { userId: f.userId } })).toBe(1);
    });
    it('uses a unique owner/currency/day key under concurrency; first successful insertion wins', async () => {
        const f = await fixture();
        const results = await Promise.all(
            Array.from({ length: 8 }, () => current().snapshot(f.userId, { currency: 'IDR' })),
        );
        const captured = await repository.findCapture(f.userId, 'IDR', '2026-10-20');
        expect(captured).toEqual({ ...results[0], balance_basis: 'captured_recorded_ledger' });
        expect(await client.netWorthObservation.count({ where: { userId: f.userId } })).toBe(1);
        if (!captured) throw new Error('Missing capture');
        await Promise.all(
            ['1.00', '2.00'].map((value) =>
                repository.capture(f.userId, {
                    ...captured,
                    known_assets: value,
                    observed_at: '2026-10-20T23:59:00.000Z',
                }),
            ),
        );
        expect(await repository.findCapture(f.userId, 'IDR', '2026-10-20')).toEqual(captured);
        await current().snapshot(f.userId, { currency: 'USD' });
        expect(await client.netWorthObservation.count({ where: { userId: f.userId } })).toBe(2);
        expect((await repository.findCapture(f.userId, 'USD', '2026-10-20'))?.known_net_worth).toBe(
            '0.00',
        );
    });
    it('never backfills missing days or exposes another owner through household sharing; inactive/deleted owners cannot retrieve captures', async () => {
        const owner = await fixture();
        const stranger = await fixture();
        await current().snapshot(owner.userId, { currency: 'IDR' });
        const groupId = generateId();
        await client.group.create({
            data: {
                id: groupId,
                code: generateId().replaceAll('-', '').slice(0, 12).toUpperCase(),
                name: 'Shared',
                createdBy: owner.userId,
                updatedBy: owner.userId,
            },
        });
        await client.userGroup.createMany({
            data: [owner.userId, stranger.userId].map((userId) => ({
                id: generateId(),
                groupId,
                userId,
                role: 'MEMBER',
                createdBy: owner.userId,
            })),
        });
        await client.groupAccount.create({
            data: { id: generateId(), groupId, accountId: owner.accountId },
        });
        expect(
            await historical().snapshot(stranger.userId, { currency: 'IDR', date: '2026-10-20' }),
        ).toMatchObject({ status: 'unavailable', accounts: [], known_net_worth: null });
        expect(
            await historical().snapshot(owner.userId, { currency: 'IDR', date: '2026-10-19' }),
        ).toMatchObject({ status: 'unavailable', known_net_worth: null });
        expect(await client.netWorthObservation.count({ where: { userId: stranger.userId } })).toBe(0);
        expect(await client.netWorthObservation.count({ where: { userId: owner.userId } })).toBe(1);
        await client.user.update({ where: { id: owner.userId }, data: { status: 'SUSPENDED' } });
        expect(await repository.findCapture(owner.userId, 'IDR', '2026-10-20')).toBeNull();
        await client.user.update({
            where: { id: owner.userId },
            data: { status: 'ACTIVE', deletedAt: tomorrow },
        });
        expect(await repository.findCapture(owner.userId, 'IDR', '2026-10-20')).toBeNull();
    });
});
