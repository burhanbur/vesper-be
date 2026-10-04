import argon2 from 'argon2';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { FakeAccountTypeRepository } from '../helpers/fake-account-type-repository.js';
import { FakeAuthRepository } from '../helpers/fake-auth-repository.js';
import { FakeAuthSessionStore } from '../helpers/fake-auth-session-store.js';
import { FakeAuthorizationRepository } from '../helpers/fake-authorization-repository.js';
import { FakeUserRepository } from '../helpers/fake-user-repository.js';

const USER_ID = '01995f6c-607b-7000-8000-000000000001';
let passwordHash = '';

beforeAll(async () => {
    passwordHash = await argon2.hash('password-kuat', { type: argon2.argon2id });
});

function testApp(accountTypeRepo = new FakeAccountTypeRepository()) {
    const authRepo = new FakeAuthRepository();
    authRepo.addUser({
        id: USER_ID,
        name: 'Budi Santoso',
        email: 'budi@example.com',
        passwordHash,
        status: 'ACTIVE',
        deletedAt: null,
        roles: ['User'],
    });
    const sessionStore = new FakeAuthSessionStore();
    const app = createApp({
        userRepository: new FakeUserRepository(),
        authRepository: authRepo,
        authSessionStore: sessionStore,
        authorizationRepository: new FakeAuthorizationRepository(),
        accountTypeRepository: accountTypeRepo,
        health: {
            checkDatabase: async () => undefined,
            checkRedis: async () => undefined,
            isShuttingDown: () => false,
        },
    });

    return { app, accountTypeRepo };
}

async function loginUser(app: ReturnType<typeof createApp>) {
    const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'budi@example.com', password: 'password-kuat' })
        .expect(200);
    return res.body.data.access_token as string;
}

describe('Account Types E2E', () => {
    it('creates an account type and defaults to CASH category with version 1', async () => {
        const { app } = testApp();
        const token = await loginUser(app);

        const response = await request(app)
            .post('/api/v1/account-types')
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'Dompet Tunai' })
            .expect(201);

        expect(response.body).toMatchObject({
            success: true,
            data: {
                name: 'Dompet Tunai',
                category: 'CASH',
                version: '1',
            },
        });
    });

    it('lists account types with filtering and pagination', async () => {
        const { app } = testApp();
        const token = await loginUser(app);

        await request(app)
            .post('/api/v1/account-types')
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'Bank BCA', category: 'CASH' })
            .expect(201);

        await request(app)
            .post('/api/v1/account-types')
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'Bibit Reksadana', category: 'INVESTMENT' })
            .expect(201);

        const listCash = await request(app)
            .get('/api/v1/account-types?category=CASH')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        expect(listCash.body.data).toHaveLength(1);
        expect(listCash.body.data[0].name).toBe('Bank BCA');

        const listAll = await request(app)
            .get('/api/v1/account-types')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);
        expect(listAll.body.data).toHaveLength(2);
    });

    it('updates account type with optimistic locking', async () => {
        const { app } = testApp();
        const token = await loginUser(app);

        const createRes = await request(app)
            .post('/api/v1/account-types')
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'Bank Mandiri' })
            .expect(201);

        const id = createRes.body.data.id as string;

        // Update with wrong version -> 409
        const conflict = await request(app)
            .patch(`/api/v1/account-types/${id}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'Bank Mandiri Baru', version: '99' })
            .expect(409);
        expect(conflict.body.message).toMatch(/versi/i);

        // Update with correct version "1" -> 200, version becomes "2"
        const success = await request(app)
            .patch(`/api/v1/account-types/${id}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'Bank Mandiri Utama', version: '1' })
            .expect(200);
        expect(success.body.data.name).toBe('Bank Mandiri Utama');
        expect(success.body.data.version).toBe('2');
    });

    it('prevents category change or deletion when account type is in use', async () => {
        const { app, accountTypeRepo } = testApp();
        const token = await loginUser(app);

        const createRes = await request(app)
            .post('/api/v1/account-types')
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'Tabungan Rekening', category: 'CASH' })
            .expect(201);

        const id = createRes.body.data.id as string;
        // Mark as referenced by accounts
        accountTypeRepo.referencedIds.add(id);

        // Try to change category to INVESTMENT -> 409
        const patchConflict = await request(app)
            .patch(`/api/v1/account-types/${id}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ category: 'INVESTMENT', version: '1' })
            .expect(409);
        expect(patchConflict.body.message).toContain('digunakan');

        // Try to delete -> 409
        const deleteConflict = await request(app)
            .delete(`/api/v1/account-types/${id}?version=1`)
            .set('Authorization', `Bearer ${token}`)
            .expect(409);
        expect(deleteConflict.body.message).toContain('digunakan');
    });
});
