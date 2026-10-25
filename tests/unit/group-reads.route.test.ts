import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { z } from '../../src/common/openapi/zod.js';
import { AppError } from '../../src/common/errors/app-error.js';
import { errorHandler } from '../../src/common/middleware/error-handler.js';
import type { AuthService } from '../../src/modules/auth/auth.service.js';
import type { GroupRepository } from '../../src/modules/groups/group.repository.js';
import { createGroupRouter } from '../../src/modules/groups/group.route.js';
import {
  GroupSharedAccountDtoSchema,
  GroupCategoryMappingDtoSchema,
} from '../../src/modules/groups/group.schema.js';
import { registerGroupOpenApi } from '../../src/modules/groups/group.openapi.js';
import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';

const actor = '019a0000-0000-7000-8000-000000000001';
const group = '019a0000-0000-7000-8000-000000000002';
const rowId = '019a0000-0000-7000-8000-000000000003';
const resource = '019a0000-0000-7000-8000-000000000004';
const account = { id: rowId, group_id: group, account_id: resource, name: 'Wallet' };
const mapping = {
  id: rowId,
  group_id: group,
  group_category_id: resource,
  user_category_id: actor,
};

vi.mock('../../src/modules/auth/auth.middleware.js', () => ({
  createRequireAuthentication:
    () => (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (req.get('authorization') !== 'Bearer test-session') {
        next(
          new AppError({
            statusCode: 401,
            code: 'UNAUTHENTICATED',
            message: 'Autentikasi diperlukan.',
          }),
        );
        return;
      }
      res.locals.auth = { id: actor };
      next();
    },
}));

function fixture() {
  const repository = {
    create: vi.fn(),
    join: vi.fn(),
    joinByCode: vi.fn(),
    list: vi.fn(),
    members: vi.fn(),
    share: vi.fn(),
    categories: vi.fn(),
    createCategory: vi.fn(),
    changeCategory: vi.fn(),
    mapping: vi.fn(),
    report: vi.fn(),
    accounts: vi.fn<GroupRepository['accounts']>(async () => ({ items: [account], total: 3 })),
    categoryMappings: vi.fn<GroupRepository['categoryMappings']>(async () => ({
      items: [mapping],
      total: 3,
    })),
  } satisfies GroupRepository;
  const app = express();
  app.use(express.json());
  app.use('/api/v1/groups', createGroupRouter(repository, {} as AuthService));
  app.use(errorHandler);
  return { app, repository };
}

const reads = [
  { path: 'accounts', method: 'accounts', dto: account },
  { path: 'category-mappings', method: 'categoryMappings', dto: mapping },
] as const;

describe('group management read HTTP contracts', () => {
  it.each(reads)(
    'requires authentication for $path before repository access',
    async ({ path, method }) => {
      const f = fixture();
      await request(f.app).get(`/api/v1/groups/${group}/${path}`).expect(401);
      expect(f.repository[method]).not.toHaveBeenCalled();
    },
  );

  it.each(reads)(
    'returns exact safe DTO and pagination for $path using authenticated actor',
    async ({ path, method, dto }) => {
      const f = fixture();
      const response = await request(f.app)
        .get(`/api/v1/groups/${group}/${path}?page=2&limit=2`)
        .set('Authorization', 'Bearer test-session')
        .expect(200)
        .expect('Cache-Control', 'no-store');
      expect(response.body).toMatchObject({
        success: true,
        total_data: 1,
        data: [dto],
        pagination: { total: 3, per_page: 2, current_page: 2, last_page: 2, from: 3, to: 3 },
      });
      expect(response.body.data).toEqual([dto]);
      expect(f.repository[method]).toHaveBeenCalledExactlyOnceWith(actor, group, {
        page: 2,
        limit: 2,
      });
    },
  );

  it.each(reads)(
    'defaults pagination and returns valid empty/out-of-range $path',
    async ({ path, method }) => {
      const f = fixture();
      if (method === 'accounts') {
        f.repository.accounts.mockResolvedValue({ items: [], total: 0 });
      } else {
        f.repository.categoryMappings.mockResolvedValue({ items: [], total: 0 });
      }
      const response = await request(f.app)
        .get(`/api/v1/groups/${group}/${path}`)
        .set('Authorization', 'Bearer test-session')
        .expect(200);
      expect(response.body).toMatchObject({
        total_data: 0,
        data: [],
        pagination: { total: 0, per_page: 20, current_page: 1, last_page: 1, from: null, to: null },
      });
      expect(f.repository[method]).toHaveBeenCalledExactlyOnceWith(actor, group, {
        page: 1,
        limit: 20,
      });
      if (method === 'accounts') {
        f.repository.accounts.mockResolvedValue({ items: [], total: 3 });
      } else {
        f.repository.categoryMappings.mockResolvedValue({ items: [], total: 3 });
      }
      const beyond = await request(f.app)
        .get(`/api/v1/groups/${group}/${path}?page=5&limit=2`)
        .set('Authorization', 'Bearer test-session')
        .expect(200);
      expect(beyond.body.pagination).toEqual({
        total: 3,
        per_page: 2,
        current_page: 5,
        last_page: 2,
        from: null,
        to: null,
      });
    },
  );

  for (const { path, method } of reads) {
    it.each([
      'page=0',
      'page=1000001',
      'limit=101',
      'limit=0',
      'page=1.5',
      'page=1&page=2',
      'user_id=other',
      'sort=name',
    ])('rejects invalid ' + path + ' query %s', async (query) => {
      const f = fixture();
      await request(f.app)
        .get(`/api/v1/groups/${group}/${path}?${query}`)
        .set('Authorization', 'Bearer test-session')
        .expect(422);
      expect(f.repository[method]).not.toHaveBeenCalled();
    });
    it('rejects invalid group UUID for ' + path, async () => {
      const f = fixture();
      await request(f.app)
        .get(`/api/v1/groups/not-a-uuid/${path}`)
        .set('Authorization', 'Bearer test-session')
        .expect(422);
      expect(f.repository[method]).not.toHaveBeenCalled();
    });
  }

  it.each(reads)('propagates generic membership denial for $path', async ({ path, method }) => {
    const f = fixture();
    vi.mocked(f.repository[method]).mockRejectedValue(
      new AppError({
        statusCode: 403,
        code: 'GROUP_ACCESS_DENIED',
        message: 'Permintaan grup tidak diizinkan.',
      }),
    );
    const response = await request(f.app)
      .get(`/api/v1/groups/${group}/${path}`)
      .set('Authorization', 'Bearer test-session')
      .expect(403);
    expect(response.body.success).toBe(false);
    expect(response.body.data).toBeUndefined();
  });

  it('strict DTO schemas reject sensitive or extra fields', () => {
    expect(GroupSharedAccountDtoSchema.parse(account)).toEqual(account);
    expect(GroupCategoryMappingDtoSchema.parse(mapping)).toEqual(mapping);
    expect(GroupSharedAccountDtoSchema.safeParse({ ...account, balance: '100.00' }).success).toBe(
      false,
    );
    expect(GroupCategoryMappingDtoSchema.safeParse({ ...mapping, user_id: actor }).success).toBe(
      false,
    );
  });

  it('allows joining via code at /api/v1/groups/join', async () => {
    const f = fixture();
    const joined = {
      id: group,
      name: 'Family Group',
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      role: 'MEMBER' as const,
    };
    f.repository.joinByCode.mockResolvedValue(joined);

    const response = await request(f.app)
      .post('/api/v1/groups/join')
      .set('Authorization', 'Bearer test-session')
      .send({ code: 'ABC123XYZ789' })
      .expect(200);

    expect(response.body.data).toEqual(joined);
    expect(f.repository.joinByCode).toHaveBeenCalledWith(actor, 'ABC123XYZ789');
  });

  it('documents authenticated paginated GET contracts separately from mutations', () => {
    const registry = new OpenAPIRegistry();
    registerGroupOpenApi(registry);
    const document = new OpenApiGeneratorV31(registry.definitions).generateDocument({
      openapi: '3.1.0',
      info: { title: 'Test', version: '1' },
    });
    for (const { path, dto } of reads) {
      const operation = document.paths?.[`/api/v1/groups/{id}/${path}`]?.get;
      expect(operation?.security).toEqual([{ bearerAuth: [] }]);
      for (const parameter of ['id', 'page', 'limit']) {
        expect(
          operation?.parameters?.some((entry) => 'name' in entry && entry.name === parameter),
        ).toBe(true);
      }
      const rawResponse: unknown = operation?.responses?.['200'];
      const response = z.record(z.string(), z.unknown()).parse(rawResponse);
      expect(response).toMatchObject({
        content: {
          'application/json': { example: { total_data: 1, pagination: { per_page: 20 } } },
        },
      });
      expect(JSON.stringify(response)).toContain(Object.keys(dto).at(-1));
      for (const status of ['401', '403', '422', '500'])
        expect(operation?.responses?.[status]).toBeDefined();
    }
  });
});
