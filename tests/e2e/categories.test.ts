import argon2 from 'argon2';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { FakeAuthRepository } from '../helpers/fake-auth-repository.js';
import { FakeAuthSessionStore } from '../helpers/fake-auth-session-store.js';
import { FakeAuthorizationRepository } from '../helpers/fake-authorization-repository.js';
import { FakeCategoryRepository } from '../helpers/fake-category-repository.js';
import { FakeUserRepository } from '../helpers/fake-user-repository.js';

const USER_ID = '01995f6c-607b-7000-8000-000000000001';
let passwordHash = '';

beforeAll(async () => {
    passwordHash = await argon2.hash('password-kuat', { type: argon2.argon2id });
});

function testApp(categoryRepo = new FakeCategoryRepository()) {
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
        categoryRepository: categoryRepo,
        health: {
            checkDatabase: async () => undefined,
            checkRedis: async () => undefined,
            isShuttingDown: () => false,
        },
    });

    return { app, categoryRepo };
}

async function loginUser(app: ReturnType<typeof createApp>) {
    const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'budi@example.com', password: 'password-kuat' })
        .expect(200);
    return res.body.data.access_token as string;
}

describe('Categories E2E', () => {
    it('creates an expense category with version 1', async () => {
        const { app } = testApp();
        const token = await loginUser(app);

        const response = await request(app)
            .post('/api/v1/categories')
            .set('Authorization', `Bearer ${token}`)
            .send({
                name: 'Makanan & Minuman',
                type: 'EXPENSE',
            })
            .expect(201);

        expect(response.body).toMatchObject({
            success: true,
            data: {
                name: 'Makanan & Minuman',
                type: 'EXPENSE',
                version: '1',
            },
        });
    });

    it('lists categories and filters by type', async () => {
        const { app } = testApp();
        const token = await loginUser(app);

        await request(app)
            .post('/api/v1/categories')
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'Belanja Bulanan', type: 'EXPENSE' })
            .expect(201);

        await request(app)
            .post('/api/v1/categories')
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'Gaji Pokok', type: 'INCOME' })
            .expect(201);

        const expenseOnly = await request(app)
            .get('/api/v1/categories?type=EXPENSE')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        expect(expenseOnly.body.data).toHaveLength(1);
        expect(expenseOnly.body.data[0].name).toBe('Belanja Bulanan');

        const incomeOnly = await request(app)
            .get('/api/v1/categories?type=INCOME')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        expect(incomeOnly.body.data).toHaveLength(1);
        expect(incomeOnly.body.data[0].name).toBe('Gaji Pokok');
    });

    it('updates category with optimistic locking and soft deletes', async () => {
        const { app } = testApp();
        const token = await loginUser(app);

        const createRes = await request(app)
            .post('/api/v1/categories')
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'Transport', type: 'EXPENSE' })
            .expect(201);

        const id = createRes.body.data.id as string;

        // Version mismatch -> 409
        const conflict = await request(app)
            .patch(`/api/v1/categories/${id}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'Transportasi Umum', version: '42' })
            .expect(409);
        expect(conflict.body.message).toMatch(/versi/i);

        // Correct version -> 200
        const updated = await request(app)
            .patch(`/api/v1/categories/${id}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'Transportasi Umum', version: '1' })
            .expect(200);
        expect(updated.body.data.name).toBe('Transportasi Umum');
        expect(updated.body.data.version).toBe('2');

        // Delete with version 2
        await request(app)
            .delete(`/api/v1/categories/${id}?version=2`)
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        // Now not found in active list
        const listRes = await request(app)
            .get('/api/v1/categories')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);
        expect(listRes.body.data).toHaveLength(0);
    });
});
