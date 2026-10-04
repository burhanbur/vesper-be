import argon2 from 'argon2';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { FakeApiKeyRepository } from '../helpers/fake-api-key-repository.js';
import { FakeAuthRepository } from '../helpers/fake-auth-repository.js';
import { FakeAuthSessionStore } from '../helpers/fake-auth-session-store.js';
import { FakeAuthorizationRepository } from '../helpers/fake-authorization-repository.js';
import { FakeUserRepository } from '../helpers/fake-user-repository.js';

const USER_ID = '01995f6c-607b-7000-8000-000000000001';
let passwordHash = '';

beforeAll(async () => {
    passwordHash = await argon2.hash('password-kuat', { type: argon2.argon2id });
});

function testApp(apiKeyRepo = new FakeApiKeyRepository()) {
    const authRepo = new FakeAuthRepository();
    authRepo.addUser({
        id: USER_ID,
        name: 'Operator Admin',
        email: 'admin@example.com',
        passwordHash,
        status: 'ACTIVE',
        deletedAt: null,
        roles: ['Super Admin'],
    });
    const sessionStore = new FakeAuthSessionStore();
    const app = createApp({
        userRepository: new FakeUserRepository(),
        authRepository: authRepo,
        authSessionStore: sessionStore,
        authorizationRepository: new FakeAuthorizationRepository(),
        apiKeyRepository: apiKeyRepo,
        health: {
            checkDatabase: async () => undefined,
            checkRedis: async () => undefined,
            isShuttingDown: () => false,
        },
    });

    return { app, apiKeyRepo, authRepo };
}

async function loginUser(app: ReturnType<typeof createApp>) {
    const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'admin@example.com', password: 'password-kuat' })
        .expect(200);
    return res.body.data.access_token as string;
}

describe('API Keys & Machine-to-Machine Authentication E2E', () => {
    it('creates an API Key and returns 64-character hex key', async () => {
        const { app } = testApp();
        const token = await loginUser(app);

        const response = await request(app)
            .post('/api/v1/api-keys')
            .set('Authorization', `Bearer ${token}`)
            .send({
                name: 'Service Worker Key',
                application: 'background-worker',
                permissions: ['sync:read', 'transactions:read'],
                rate_limit: 120,
            })
            .expect(201);

        expect(response.body).toMatchObject({
            success: true,
            data: {
                name: 'Service Worker Key',
                application: 'background-worker',
                permissions: ['sync:read', 'transactions:read'],
                rate_limit: 120,
                is_active: true,
            },
        });
        expect((response.body as { message: string }).message).toContain('berhasil dibuat');

        const body = response.body as unknown as { data: { key: string } };
        const key = body.data.key;
        expect(key).toHaveLength(64);
    });

    it('verifies M2M authentication with X-API-Key header', async () => {
        const { app } = testApp();
        const token = await loginUser(app);

        // Create an API key
        const createRes = await request(app)
            .post('/api/v1/api-keys')
            .set('Authorization', `Bearer ${token}`)
            .send({
                name: 'M2M Integration',
                application: 'payment-gateway',
                permissions: ['transactions:create'],
            })
            .expect(201);

        const apiKey = createRes.body.data.key as string;

        // Call verify endpoint with valid key
        const verifyRes = await request(app)
            .get('/api/v1/api-keys/verify')
            .set('X-API-Key', apiKey)
            .expect(200);

        expect(verifyRes.body).toMatchObject({
            success: true,
            data: {
                name: 'M2M Integration',
                application: 'payment-gateway',
                permissions: ['transactions:create'],
                authenticated: true,
            },
        });

        // Call without header -> 401
        await request(app).get('/api/v1/api-keys/verify').expect(401);

        // Call with fake key -> 401
        await request(app)
            .get('/api/v1/api-keys/verify')
            .set('X-API-Key', 'fakekey0000000000000000000000000000000000000000000000000000000000')
            .expect(401);
    });

    it('rejects revoked or expired API keys with 403', async () => {
        const { app, apiKeyRepo } = testApp();
        const token = await loginUser(app);

        // Create an active key with future expiration
        const futureDate = new Date(Date.now() + 86400_000).toISOString();
        const createRes = await request(app)
            .post('/api/v1/api-keys')
            .set('Authorization', `Bearer ${token}`)
            .send({
                name: 'Key To Expire',
                expires_at: futureDate,
            })
            .expect(201);

        const apiKey = createRes.body.data.key as string;
        const keyId = createRes.body.data.id as string;

        // Simulate key expiration by setting expiresAt to the past
        const record = apiKeyRepo.records.get(keyId)!;
        record.expiresAt = new Date(Date.now() - 3600_000);

        const expiredRes = await request(app)
            .get('/api/v1/api-keys/verify')
            .set('X-API-Key', apiKey)
            .expect(403);
        expect(expiredRes.body.message).toContain('kedaluwarsa');

        // Restore expiration but deactivate key
        record.expiresAt = new Date(Date.now() + 86400_000);
        record.isActive = false;

        const revokedRes = await request(app)
            .get('/api/v1/api-keys/verify')
            .set('X-API-Key', apiKey)
            .expect(403);
        expect(revokedRes.body.message).toContain('tidak aktif');
    });

    it('supports listing, pagination, and deletion of API keys', async () => {
        const { app } = testApp();
        const token = await loginUser(app);

        const res = await request(app)
            .post('/api/v1/api-keys')
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'Key to Delete' })
            .expect(201);

        const keyId = res.body.data.id as string;

        // List keys
        const listRes = await request(app)
            .get('/api/v1/api-keys')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);
        expect(listRes.body.data).toHaveLength(1);
        expect(listRes.body.data[0].key).toBeUndefined(); // Raw key never in list
        expect(listRes.body.data[0].key_prefix).toBeDefined();

        // Delete key
        await request(app)
            .delete(`/api/v1/api-keys/${keyId}`)
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        // Verify it is gone
        await request(app)
            .get(`/api/v1/api-keys/${keyId}`)
            .set('Authorization', `Bearer ${token}`)
            .expect(404);
    });
});
