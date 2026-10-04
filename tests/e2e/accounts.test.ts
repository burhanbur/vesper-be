import argon2 from 'argon2';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { FakeAccountRepository } from '../helpers/fake-account-repository.js';
import { FakeAuthRepository } from '../helpers/fake-auth-repository.js';
import { FakeAuthSessionStore } from '../helpers/fake-auth-session-store.js';
import { FakeAuthorizationRepository } from '../helpers/fake-authorization-repository.js';
import { FakeUserRepository } from '../helpers/fake-user-repository.js';

const TEST_USER_ID = '01995f6c-607b-7000-8000-000000000001';
const TEST_ACCOUNT_TYPE_ID = '01995f6c-607b-7000-8000-000000000002';

async function setupApp() {
    const authRepository = new FakeAuthRepository();
    const passwordHash = await argon2.hash('Password123!', { type: argon2.argon2id });
    authRepository.addUser({
        id: TEST_USER_ID,
        name: 'Account Tester',
        email: 'accounts@example.com',
        passwordHash,
        status: 'ACTIVE',
        deletedAt: null,
        roles: ['User'],
    });

    const authSessionStore = new FakeAuthSessionStore();
    const authorizationRepository = new FakeAuthorizationRepository();
    const accountRepository = new FakeAccountRepository();
    accountRepository.activeAccountTypeIds.add(TEST_ACCOUNT_TYPE_ID);

    const app = createApp({
        userRepository: new FakeUserRepository(),
        authRepository,
        authSessionStore,
        authorizationRepository,
        accountRepository,
        health: {
            checkDatabase: async () => undefined,
            checkRedis: async () => undefined,
            isShuttingDown: () => false,
        },
    });

    const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'accounts@example.com', password: 'Password123!' });

    const token = loginRes.body.data.access_token as string;
    return { app, token, accountRepository };
}

describe('Accounts E2E', () => {
    it('creates an account with balance 0.00 and version 1', async () => {
        const { app, token } = await setupApp();

        const response = await request(app)
            .post('/api/v1/accounts')
            .set('Authorization', `Bearer ${token}`)
            .send({
                account_type_id: TEST_ACCOUNT_TYPE_ID,
                name: 'Rekening BCA',
                currency: 'IDR',
                is_visible: true,
                is_include_total: true,
                sequence_order: '1',
            })
            .expect(201);

        expect(response.body).toMatchObject({
            success: true,
            data: {
                name: 'Rekening BCA',
                currency: 'IDR',
                balance: '0.00',
                version: '1',
                is_visible: true,
                is_include_total: true,
            },
        });
    });

    it('lists accounts with pagination', async () => {
        const { app, token } = await setupApp();

        await request(app)
            .post('/api/v1/accounts')
            .set('Authorization', `Bearer ${token}`)
            .send({
                account_type_id: TEST_ACCOUNT_TYPE_ID,
                name: 'Dompet Utama',
            })
            .expect(201);

        const listRes = await request(app)
            .get('/api/v1/accounts')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        expect(listRes.body.data).toHaveLength(1);
        expect(listRes.body.data[0].name).toBe('Dompet Utama');
        expect(listRes.body.pagination).toBeDefined();
    });

    it('updates an account and bumps version', async () => {
        const { app, token } = await setupApp();

        const created = await request(app)
            .post('/api/v1/accounts')
            .set('Authorization', `Bearer ${token}`)
            .send({
                account_type_id: TEST_ACCOUNT_TYPE_ID,
                name: 'Kantong Bibit',
            })
            .expect(201);

        const accountId = created.body.data.id as string;

        const updated = await request(app)
            .patch(`/api/v1/accounts/${accountId}`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                name: 'Kantong Bibit Reksadana',
                version: '1',
            })
            .expect(200);

        expect(updated.body.data.name).toBe('Kantong Bibit Reksadana');
        expect(updated.body.data.version).toBe('2');

        // Attempting update with outdated version 1 must return 409
        await request(app)
            .patch(`/api/v1/accounts/${accountId}`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                name: 'Kantong Bibit Saham',
                version: '1',
            })
            .expect(409);
    });

    it('deletes an account with version query', async () => {
        const { app, token } = await setupApp();

        const created = await request(app)
            .post('/api/v1/accounts')
            .set('Authorization', `Bearer ${token}`)
            .send({
                account_type_id: TEST_ACCOUNT_TYPE_ID,
                name: 'Tabungan Darurat',
            })
            .expect(201);

        const accountId = created.body.data.id as string;

        await request(app)
            .delete(`/api/v1/accounts/${accountId}?version=1`)
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        // List should now be empty
        const listRes = await request(app)
            .get('/api/v1/accounts')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        expect(listRes.body.data).toHaveLength(0);
    });
});
