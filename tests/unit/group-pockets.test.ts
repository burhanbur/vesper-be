import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { errorHandler } from '../../src/common/middleware/error-handler.js';
import { AppError } from '../../src/common/errors/app-error.js';
import type { AuthService } from '../../src/modules/auth/auth.service.js';
import { createPocketRouter } from '../../src/modules/groups/pocket.route.js';
import { pocketBalances, type PocketRepository } from '../../src/modules/groups/pocket.repository.js';
import { CreatePocketSchema, PocketDtoSchema } from '../../src/modules/groups/pocket.schema.js';
import { registerPocketOpenApi } from '../../src/modules/groups/pocket.openapi.js';

const actor = '019a0000-0000-7000-8000-000000000001';
const group = '019a0000-0000-7000-8000-000000000002';
const pocket = '019a0000-0000-7000-8000-000000000003';
const account = '019a0000-0000-7000-8000-000000000004';
const dto = { id: pocket, name: 'Travel', description: null, accounts: [], balances: [] };
vi.mock('../../src/modules/auth/auth.middleware.js', () => ({
    createRequireAuthentication: () => (req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (!req.get('authorization')) return next(new AppError({ statusCode: 401, code: 'UNAUTHENTICATED', message: 'Autentikasi diperlukan.' }));
        res.locals.auth = { id: actor }; next();
    },
}));
function fixture() {
    const repository = {
        read: vi.fn<PocketRepository['read']>(async () => [dto]),
        create: vi.fn<PocketRepository['create']>(async () => dto),
        update: vi.fn<PocketRepository['update']>(async () => ({ ...dto, name: 'Renamed' })),
        delete: vi.fn<PocketRepository['delete']>(async () => { return undefined; }),
        assign: vi.fn<PocketRepository['assign']>(async () => { return undefined; }),
    };
    const app = express(); app.use(express.json());
    app.use('/api/v1/groups', createPocketRouter(repository, {} as AuthService)); app.use(errorHandler);
    return { app, repository };
}
describe('group pockets contract', () => {
    it('sums exact strings by currency beyond Number precision', () => {
        const row = { account_id: account, name: 'Bank - Child', owner_user_id: actor, owner_name: 'Alice' };
        expect(pocketBalances([
            { ...row, currency: 'IDR', balance: '9007199254740993.01' },
            { ...row, currency: 'USD', balance: '-0.10' },
            { ...row, currency: 'IDR', balance: '0.09' },
        ])).toEqual([{ currency: 'IDR', balance: '9007199254740993.10' }, { currency: 'USD', balance: '-0.10' }]);
    });
    it('validates purpose names, bounds, strict fields and string money', () => {
        expect(CreatePocketSchema.parse({ name: ' Travel ' })).toEqual({ name: 'Travel' });
        for (const input of [{ name: '' }, { name: '  ' }, { name: 'x'.repeat(121) }, { name: 'Travel', balance: '100' }, { name: 'Travel', description: 'x'.repeat(2001) }]) expect(CreatePocketSchema.safeParse(input).success).toBe(false);
        expect(PocketDtoSchema.safeParse(dto).success).toBe(true);
    });
    it('requires authentication before reads and writes', async () => {
        const f = fixture();
        await request(f.app).get(`/api/v1/groups/${group}/pockets`).expect(401);
        await request(f.app).post(`/api/v1/groups/${group}/pockets`).send({ name: 'Travel' }).expect(401);
        expect(f.repository.read).not.toHaveBeenCalled(); expect(f.repository.create).not.toHaveBeenCalled();
    });
    it('returns the agreed array envelope and passes create/assign/unassign exactly', async () => {
        const f = fixture(), base = `/api/v1/groups/${group}/pockets`;
        const read = await request(f.app).get(base).set('Authorization', 'Bearer test').expect(200);
        expect(read.body).toMatchObject({ success: true, total_data: 1, data: [dto] });
        expect(read.headers['cache-control']).toBe('no-store');
        await request(f.app).post(base).set('Authorization', 'Bearer test').send({ name: 'Travel' }).expect(201);
        expect(f.repository.create).toHaveBeenCalledWith(actor, group, { name: 'Travel' });
        await request(f.app).patch(`${base}/${pocket}`).set('Authorization', 'Bearer test').send({ name: 'Renamed' }).expect(200);
        expect(f.repository.update).toHaveBeenCalledWith(actor, group, pocket, { name: 'Renamed' });
        await request(f.app).delete(`${base}/${pocket}`).set('Authorization', 'Bearer test').expect(200);
        expect(f.repository.delete).toHaveBeenCalledWith(actor, group, pocket);
        await request(f.app).post(`${base}/${pocket}/accounts`).set('Authorization', 'Bearer test').send({ account_id: account }).expect(200);
        expect(f.repository.assign).toHaveBeenLastCalledWith(actor, group, pocket, account, false);
        await request(f.app).delete(`${base}/${pocket}/accounts`).set('Authorization', 'Bearer test').send({ account_id: account }).expect(200);
        expect(f.repository.assign).toHaveBeenLastCalledWith(actor, group, pocket, account, true);
        await request(f.app).post(`${base}/${pocket}/accounts`).set('Authorization', 'Bearer test').send({ account_id: 'invalid' }).expect(422);
    });
    it('registers all operations with the shared schemas', () => {
        const registry = new OpenAPIRegistry(); registerPocketOpenApi(registry);
        const doc = new OpenApiGeneratorV31(registry.definitions).generateDocument({ openapi: '3.1.0', info: { title: 'Pockets', version: '1' } });
        expect(doc.paths?.['/api/v1/groups/{groupId}/pockets']?.get?.operationId).toBe('listGroupPockets');
        expect(doc.paths?.['/api/v1/groups/{groupId}/pockets']?.post?.responses?.['201']).toBeDefined();
        expect(doc.paths?.['/api/v1/groups/{groupId}/pockets/{pocketId}']?.patch?.operationId).toBe('updateGroupPocket');
        expect(doc.paths?.['/api/v1/groups/{groupId}/pockets/{pocketId}']?.delete?.operationId).toBe('deleteGroupPocket');
        expect(doc.paths?.['/api/v1/groups/{groupId}/pockets/{pocketId}/accounts']?.delete?.requestBody).toBeDefined();
    });
});
