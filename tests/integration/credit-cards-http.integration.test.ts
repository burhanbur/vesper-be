import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { integrationDatabaseUrl } from '../../src/config/integration-test.js';
import { config } from '../../src/config/index.js';
import { generateId } from '../../src/common/utils/id.js';
import { errorHandler } from '../../src/common/middleware/error-handler.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { syncClient } from '../../src/infrastructure/database/sync-publication.js';
import { PrismaAuthUserRepository } from '../../src/modules/auth/auth-user.repository.js';
import { createAuthService } from '../../src/modules/auth/auth.route.js';
import { PrismaAccountRepository } from '../../src/modules/accounts/account.repository.js';
import { createAccountRouter } from '../../src/modules/accounts/account.route.js';
import { PrismaTransactionRepository } from '../../src/modules/transactions/transaction.repository.js';
import { createTransactionRouter } from '../../src/modules/transactions/transaction.route.js';
import { PrismaTransferRepository } from '../../src/modules/transfers/transfer.repository.js';
import { createTransferRouter } from '../../src/modules/transfers/transfer.route.js';
import { SyncRepository } from '../../src/modules/sync/sync.repository.js';
import { createSyncRouter } from '../../src/modules/sync/sync.route.js';
import { FakeAuthSessionStore } from '../helpers/fake-auth-session-store.js';

// Never load .env or construct the application's default Prisma/Redis clients.
vi.mock('../../src/config/index.js', async () => {
    const { loadConfig } = await import('../../src/config/env.js');
    const { integrationDatabaseUrl } = await import('../../src/config/integration-test.js');
    return {
        config: loadConfig({
            NODE_ENV: 'test',
            DATABASE_URL: integrationDatabaseUrl(),
            REDIS_URL: 'redis://127.0.0.1:1',
            CORS_ORIGINS: 'http://integration.invalid',
            JWT_ACCESS_SECRET: 'isolated-http-access-fixture-only-0000',
            JWT_REFRESH_SECRET: 'isolated-http-refresh-fixture-only-0000',
            LOG_LEVEL: 'silent',
        }),
    };
});

const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: integrationDatabaseUrl() }),
});
// Route-level HTTP integration, not the full createApp middleware stack or real Redis auth.
// Mirror createApp's sync-published repository injection without importing default clients.
const published = syncClient(client);
const auth = createAuthService(
    new PrismaAuthUserRepository(client),
    new FakeAuthSessionStore(),
    config,
);
const app = express();
app.use(express.json());
app.use('/api/v1/accounts', createAccountRouter(new PrismaAccountRepository(published), auth));
app.use(
    '/api/v1/transactions',
    createTransactionRouter(new PrismaTransactionRepository(published), auth),
);
app.use('/api/v1/transfers', createTransferRouter(new PrismaTransferRepository(published), auth));
app.use('/api/v1/sync', createSyncRouter(new SyncRepository(client), auth));
app.use(errorHandler);

beforeAll(async () => {
    expect(
        await client.$queryRaw`SELECT current_database() AS database, current_user AS username`,
    ).toEqual([{ database: 'vesper_integration_test', username: 'vesper_integration' }]);
});
afterAll(async () => client.$disconnect());

it('HTTP cards and offline push/pull converge with exact money, stable IDs and replay-safe overpayment', async () => {
    const session = await auth.register({
        name: 'Isolated HTTP card',
        email: `${generateId()}@example.invalid`,
        password: 'Isolated-test-password-123!',
    });
    const userId = session.user.id;
    const authorization = `Bearer ${session.tokens.accessToken}`;
    const typeId = generateId();
    const categoryId = generateId();
    const deviceId = generateId();
    await client.accountType.create({ data: { id: typeId, userId, name: 'Cash' } });
    await client.category.create({ data: { id: categoryId, userId, name: 'Food', type: 'EXPENSE' } });
    await client.device.create({
        data: { id: deviceId, userId, name: 'Mobile fixture', platform: 'Android', appVersion: 'test' },
    });
    await request(app).post('/api/v1/accounts').send({}).expect(401);
    const post = (path: string, body: object) =>
        request(app).post(`/api/v1/${path}`).set('Authorization', authorization).send(body);
    const cardResponse = await post('accounts', {
        account_type_id: typeId,
        name: 'Explicit card',
        is_credit_card: true,
        credit_limit: '1000000.23',
    }).expect(201);
    const cardId = z.object({ data: z.object({ id: z.uuid() }) }).parse(cardResponse.body).data.id;
    expect(cardResponse.body.data).toMatchObject({
        balance: '0.00',
        is_credit_card: true,
        credit_limit: '1000000.23',
        version: '1',
    });
    const bankResponse = await post('accounts', { account_type_id: typeId, name: 'Bank' }).expect(
        201,
    );
    const bankId = z.object({ data: z.object({ id: z.uuid() }) }).parse(bankResponse.body).data.id;
    const expense = (amount: string) => ({
        account_id: cardId,
        category_id: categoryId,
        type: 'EXPENSE',
        amount,
        transacted_at: '2026-11-06T00:00:00Z',
    });
    const expectHttpBalances = async (cardBalance: string, bankBalance: string) => {
        const response = await request(app)
            .get('/api/v1/accounts')
            .set('Authorization', authorization)
            .expect(200);
        const rows = z
            .object({
                data: z.array(
                    z.object({
                        id: z.uuid(),
                        balance: z.string(),
                        is_credit_card: z.boolean(),
                        credit_limit: z.string().nullable(),
                    }),
                ),
            })
            .parse(response.body).data;
        expect(rows.find((row) => row.id === cardId)).toEqual({
            id: cardId,
            balance: cardBalance,
            is_credit_card: true,
            credit_limit: '1000000.23',
        });
        expect(rows.find((row) => row.id === bankId)).toEqual({
            id: bankId,
            balance: bankBalance,
            is_credit_card: false,
            credit_limit: null,
        });
    };
    await expectHttpBalances('0.00', '0.00');
    await post('transactions', expense('2000000.00')).expect(201);
    await expectHttpBalances('-2000000.00', '0.00');
    await post('transfers', {
        from_account_id: bankId,
        to_account_id: cardId,
        amount: '2500000.00',
        transacted_at: '2026-11-06T00:00:00Z',
    }).expect(201);
    const balance = async () =>
        (await client.account.findUniqueOrThrow({ where: { id: cardId } })).balance.toFixed(2);
    expect(await balance()).toBe('500000.00');
    await expectHttpBalances('500000.00', '-2500000.00');
    await post('transactions', expense('200000.00')).expect(201);
    expect(await balance()).toBe('300000.00');
    await expectHttpBalances('300000.00', '-2500000.00');
    await post('transactions', expense('400000.00')).expect(201);
    expect(await balance()).toBe('-100000.00');
    await expectHttpBalances('-100000.00', '-2500000.00');

    // Exercise the mobile-shaped wire contract only; no Flutter/outbox/UI code runs here.
    const offlineCardId = generateId();
    const purchaseId = generateId();
    const transferId = generateId();
    const fromLeg = generateId();
    const toLeg = generateId();
    const subsequentIds = [generateId(), generateId()];
    const item = (entity_type: string, entity_id: string, payload: object) => ({
        entity_type,
        entity_id,
        operation: 'CREATE',
        client_version: '0',
        payload,
    });
    const items = [
        item('accounts', offlineCardId, {
            account_type_id: typeId,
            name: 'Offline card',
            is_credit_card: true,
            credit_limit: null,
        }),
        item('transactions', purchaseId, { ...expense('2000000.00'), account_id: offlineCardId }),
        item('transfers', transferId, {
            from_account_id: bankId,
            to_account_id: offlineCardId,
            from_transaction_id: fromLeg,
            to_transaction_id: toLeg,
            amount: '2500000.00',
            transacted_at: '2026-11-06T00:00:00Z',
            description: null,
        }),
        ...subsequentIds.map((id, index) =>
            item('transactions', id, {
                ...expense(index === 0 ? '200000.00' : '400000.00'),
                account_id: offlineCardId,
            }),
        ),
    ];
    const pushed = await post('sync/push', { device_id: deviceId, items }).expect(200);
    const results = z
        .object({
            data: z.object({
                results: z.array(
                    z.object({
                        index: z.number(),
                        entity_id: z.uuid(),
                        status: z.literal('applied'),
                    }),
                ),
            }),
        })
        .parse(pushed.body).data.results;
    expect(results).toEqual(
        items.map((entry, index) => ({
            index,
            entity_id: entry.entity_id,
            status: 'applied',
        })),
    );
    const beforeReplay = await client.syncChange.count({ where: { userId } });
    const replay = await post('sync/push', { device_id: deviceId, items: [items[2]] }).expect(200);
    expect(replay.body.data.results[0].status).toBe('applied');
    expect(await client.syncChange.count({ where: { userId } })).toBe(beforeReplay);
    expect(await client.transfer.count({ where: { id: transferId } })).toBe(1);
    expect(await client.transaction.count({ where: { transferId } })).toBe(2);
    expect(await client.transaction.count({ where: { accountId: offlineCardId } })).toBe(4);
    expect(
        (await client.account.findUniqueOrThrow({ where: { id: offlineCardId } })).balance.toFixed(2),
    ).toBe('-100000.00');
    await expectHttpBalances('-100000.00', '-5000000.00');

    const pull = () =>
        request(app)
            .get('/api/v1/sync/pull')
            .set('Authorization', authorization)
            .query({ device_id: deviceId, since_version: '0', limit: 100, compact: 'true' });
    const pulled = await pull().expect(200);
    const changes = z
        .object({
            data: z.object({
                changes: z.array(
                    z.object({
                        entity_id: z.uuid(),
                        entity_type: z.string(),
                        operation: z.enum(['CREATE', 'UPDATE']),
                        version: z.string().regex(/^[1-9]\d*$/),
                        payload: z.record(z.string(), z.unknown()),
                    }),
                ),
            }),
        })
        .parse(pulled.body).data.changes;
    expect(pulled.body.data.has_more).toBe(false);
    expect(typeof pulled.body.data.next_version).toBe('string');
    expect(changes.find((entry) => entry.entity_id === offlineCardId)?.payload).toMatchObject({
        id: offlineCardId,
        balance: '-100000.00',
        is_credit_card: true,
        credit_limit: null,
    });
    expect(changes.find((entry) => entry.entity_id === cardId)?.payload).toMatchObject({
        id: cardId,
        balance: '-100000.00',
        is_credit_card: true,
        credit_limit: '1000000.23',
    });
    for (const [id, amount] of [
        [fromLeg, '-2500000.00'],
        [toLeg, '2500000.00'],
    ]) {
        expect(changes.find((entry) => entry.entity_id === id)?.payload).toMatchObject({
            id,
            transfer_id: transferId,
            type: 'TRANSFER',
            amount,
        });
    }
    for (const id of [purchaseId, ...subsequentIds]) {
        expect(changes.find((entry) => entry.entity_id === id)?.payload).toMatchObject({
            id,
            account_id: offlineCardId,
            type: 'EXPENSE',
        });
    }
    expect(changes.some((entry) => entry.entity_type === 'transfers')).toBe(false);
    const cursor = z
        .object({
            next_version: z.string().regex(/^[1-9]\d*$/),
            watermark: z.string().regex(/^[1-9]\d*$/),
        })
        .parse(pulled.body.data);
    expect(cursor.next_version).toBe(cursor.watermark);
    const versions = changes.map((entry) => BigInt(entry.version));
    expect(versions).toEqual([...versions].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(new Set(changes.map((entry) => `${entry.entity_type}:${entry.entity_id}`)).size).toBe(
        changes.length,
    );
    expect(versions.every((version) => version <= BigInt(cursor.watermark))).toBe(true);
    expect((await pull().expect(200)).body.data).toEqual(pulled.body.data);
    const incremental = await request(app)
        .get('/api/v1/sync/pull')
        .set('Authorization', authorization)
        .query({ device_id: deviceId, since_version: cursor.next_version, limit: 100, compact: 'true' })
        .expect(200);
    expect(incremental.body.data).toEqual({ ...cursor, changes: [], has_more: false });
});
