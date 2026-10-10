import argon2 from 'argon2';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import type { ReferenceRepository } from '../../src/modules/references/reference.repository.js';
import { FakeAuthRepository } from '../helpers/fake-auth-repository.js';
import { FakeAuthSessionStore } from '../helpers/fake-auth-session-store.js';
import { FakeAuthorizationRepository } from '../helpers/fake-authorization-repository.js';
import { FakeUserRepository } from '../helpers/fake-user-repository.js';

const USER_ID = '01995f6c-607b-7000-8000-000000000001';
const record = {
    id: '01995f6c-607b-7000-8000-000000000002',
    name: 'Bank',
    createdAt: new Date('2026-10-10T10:00:00.000Z'),
    updatedAt: new Date('2026-10-10T11:00:00.000Z'),
};
let passwordHash = '';
beforeAll(async () => {
    passwordHash = await argon2.hash('password-kuat', { type: argon2.argon2id });
});

function testApp() {
    const repository = {
        listAccountTypes: vi.fn<ReferenceRepository['listAccountTypes']>().mockResolvedValue({ items: [record], total: 3 }),
        listCategories: vi.fn<ReferenceRepository['listCategories']>().mockResolvedValue({ items: [{ ...record, name: 'Gaji', type: 'INCOME' }], total: 3 }),
    };
    const authRepository = new FakeAuthRepository();
    authRepository.addUser({ id: USER_ID, name: 'Budi', email: 'budi@example.com', passwordHash, status: 'ACTIVE', deletedAt: null, roles: ['User'] });
    const authorizationRepository = new FakeAuthorizationRepository();
    const app = createApp({
        userRepository: new FakeUserRepository(), authRepository,
        authSessionStore: new FakeAuthSessionStore(), authorizationRepository,
        referenceRepository: repository,
        health: { checkDatabase: async () => undefined, checkRedis: async () => undefined, isShuttingDown: () => false },
    });
    return { app, repository, authRepository };
}

async function login(app: ReturnType<typeof createApp>) {
    const response = await request(app).post('/api/v1/auth/login').send({ email: 'budi@example.com', password: 'password-kuat' }).expect(200);
    return response.body.data.access_token as string;
}

for (const path of ['ref-categories', 'ref-account-types']) {
    describe(`GET /api/v1/${path}`, () => {
        it('requires a valid authenticated session before calling the repository', async () => {
            const { app, repository } = testApp();
            await request(app).get(`/api/v1/${path}?limit=0`).expect(401);
            await request(app).get(`/api/v1/${path}`).set('Authorization', 'Bearer invalid').expect(401);
            expect(repository.listCategories).not.toHaveBeenCalled();
            expect(repository.listAccountTypes).not.toHaveBeenCalled();
        });

        it('allows an ordinary user without permissions and maps DTOs/pagination', async () => {
            const { app, repository } = testApp();
            const token = await login(app);
            const response = await request(app).get(`/api/v1/${path}?page=2&limit=1&sort=name&name=%20Ba%20${path === 'ref-categories' ? '&type=INCOME' : ''}`).set('Authorization', `Bearer ${token}`).expect(200);
            const list = path === 'ref-categories' ? repository.listCategories : repository.listAccountTypes;
            expect(list).toHaveBeenCalledWith({ page: 2, limit: 1, sort: 'name', name: 'Ba', ...(path === 'ref-categories' ? { type: 'INCOME' } : {}) });
            expect(response.body).toMatchObject({ success: true, total_data: 1, pagination: { total: 3, per_page: 1, current_page: 2, last_page: 3, from: 2, to: 2 } });
            expect(response.body.data).toEqual([{ id: record.id, name: path === 'ref-categories' ? 'Gaji' : 'Bank', created_at: record.createdAt.toISOString(), updated_at: record.updatedAt.toISOString(), ...(path === 'ref-categories' ? { type: 'INCOME' } : {}) }]);
            expect(response.headers['cache-control']).toBe('no-store');
            expect(response.headers['x-request-id']).toBeTruthy();
        });

        it('applies defaults and represents empty/out-of-range pages', async () => {
            const { app, repository } = testApp();
            repository.listCategories.mockResolvedValue({ items: [], total: 0 });
            repository.listAccountTypes.mockResolvedValue({ items: [], total: 0 });
            const token = await login(app);
            const response = await request(app).get(`/api/v1/${path}`).set('Authorization', `Bearer ${token}`).expect(200);
            const list = path === 'ref-categories' ? repository.listCategories : repository.listAccountTypes;
            expect(list).toHaveBeenCalledWith({ page: 1, limit: 20, sort: '-created_at' });
            expect(response.body).toMatchObject({ total_data: 0, data: [], pagination: { total: 0, per_page: 20, current_page: 1, last_page: 1, from: null, to: null } });
            repository.listCategories.mockResolvedValue({ items: [], total: 3 });
            repository.listAccountTypes.mockResolvedValue({ items: [], total: 3 });
            const beyond = await request(app).get(`/api/v1/${path}?page=4&limit=1`).set('Authorization', `Bearer ${token}`).expect(200);
            expect(beyond.body.pagination).toEqual({ total: 3, per_page: 1, current_page: 4, last_page: 3, from: null, to: null });
        });

        it('rejects malformed queries without reading reference data', async () => {
            const { app, repository } = testApp();
            const token = await login(app);
            for (const query of ['page=0', 'page=1.5', 'page=1000001', 'limit=101', 'limit=0', 'sort=type', 'name=%20', 'unknown=1', 'type=CASH', 'limit=1&limit=2']) {
                const response = await request(app).get(`/api/v1/${path}?${query}`).set('Authorization', `Bearer ${token}`).expect(422);
                expect(response.body.success).toBe(false);
            }
            expect(repository.listCategories).not.toHaveBeenCalled();
            expect(repository.listAccountTypes).not.toHaveBeenCalled();
        });

        it('rejects an inactive user even with an issued token', async () => {
            const { app, authRepository, repository } = testApp();
            const token = await login(app);
            authRepository.addUser({ id: USER_ID, name: 'Budi', email: 'budi@example.com', passwordHash, status: 'INACTIVE', deletedAt: null, roles: ['User'] });
            await request(app).get(`/api/v1/${path}`).set('Authorization', `Bearer ${token}`).expect(401);
            expect(repository.listCategories).not.toHaveBeenCalled();
            expect(repository.listAccountTypes).not.toHaveBeenCalled();
        });

        it('returns a safe error envelope on repository failure', async () => {
            const { app, repository } = testApp();
            repository.listCategories.mockRejectedValue(new Error('private database detail'));
            repository.listAccountTypes.mockRejectedValue(new Error('private database detail'));
            const token = await login(app);
            const response = await request(app).get(`/api/v1/${path}`).set('Authorization', `Bearer ${token}`).expect(500);
            expect(response.body.success).toBe(false);
            expect(JSON.stringify(response.body)).not.toContain('private database detail');
        });

        it('does not expose write or detail routes', async () => {
            const { app, repository } = testApp();
            const token = await login(app);
            await request(app).post(`/api/v1/${path}`).set('Authorization', `Bearer ${token}`).send({ name: 'Change' }).expect(404);
            await request(app).patch(`/api/v1/${path}/${record.id}`).set('Authorization', `Bearer ${token}`).send({ name: 'Change' }).expect(404);
            await request(app).delete(`/api/v1/${path}/${record.id}`).set('Authorization', `Bearer ${token}`).expect(404);
            await request(app).get(`/api/v1/${path}/${record.id}`).set('Authorization', `Bearer ${token}`).expect(404);
            expect(repository.listCategories).not.toHaveBeenCalled();
            expect(repository.listAccountTypes).not.toHaveBeenCalled();
        });
    });
}
