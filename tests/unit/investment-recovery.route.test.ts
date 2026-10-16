import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/common/errors/app-error.js';
import { errorHandler } from '../../src/common/middleware/error-handler.js';
import type { AuthService } from '../../src/modules/auth/auth.service.js';
import { createSyncRouter } from '../../src/modules/sync/sync.route.js';
import type { SyncRepository } from '../../src/modules/sync/sync.repository.js';
import {
  RecoveryRequestSchema,
  commandFingerprint,
} from '../../src/modules/sync/investment-recovery.schema.js';
import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { registerSyncOpenApi } from '../../src/modules/sync/sync.openapi.js';

const actor = '019a0000-0000-7000-8000-000000000001';
const canonical =
  '{"client_version":"0","entity_id":"44444444-4444-4444-8444-444444444444","entity_type":"investment_transactions","operation":"CREATE","payload":{"account_id":"11111111-1111-4111-8111-111111111111","cash_account_id":"22222222-2222-4222-8222-222222222222","description":"Recovery test","fee":"0","instrument_id":"33333333-3333-4333-8333-333333333333","linked_transaction_id":"55555555-5555-4555-8555-555555555555","price_per_unit":"10.005","quantity":"1","transacted_at":"2026-10-16T00:00:00.000Z","type":"BUY"}}';
const parsed: unknown = JSON.parse(canonical);
const body = RecoveryRequestSchema.parse({
  device_id: actor,
  command: parsed,
  command_sha256: '5bd9978d357c75ff87322d6be56efd918a35cbea47784495deda6f8854fa3864',
});
vi.mock('../../src/modules/auth/auth.middleware.js', () => ({
  createRequireAuthentication:
    () => (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (req.get('authorization') !== 'Bearer fixture')
        return next(
          new AppError({
            statusCode: 401,
            code: 'AUTH_REQUIRED',
            message: 'Autentikasi diperlukan.',
          }),
        );
      res.locals.auth = { id: actor, roles: ['untrusted-role-claim'] };
      next();
    },
}));
function fixture() {
  const receipt = {
    user_id: actor,
    trade_id: body.command.entity_id,
    linked_transaction_id: body.command.payload.linked_transaction_id,
    command_sha256: body.command_sha256,
    status: 'PENDING',
    requested_at: '2026-10-16T00:00:00.000Z',
    reviewed_at: null,
  };
  const repository = {
    requestRecovery: vi.fn().mockResolvedValue(receipt),
    recoveryReceipt: vi.fn().mockResolvedValue(receipt),
    reviewRecovery: vi
      .fn()
      .mockRejectedValue(
        new AppError({ statusCode: 403, code: 'DENIED', message: 'Izin diperlukan.' }),
      ),
  };
  const app = express();
  app.use(express.json());
  app.use('/sync', createSyncRouter(repository as unknown as SyncRepository, {} as AuthService));
  app.use(errorHandler);
  return { app, repository, receipt };
}
describe('investment recovery HTTP contract', () => {
  it('uses the same canonical wire fingerprint as Dart without a local queue ID', () => {
    expect(commandFingerprint(body.command)).toBe(body.command_sha256);
    const reordered = Object.fromEntries(Object.entries(body.command).reverse());
    expect(commandFingerprint(reordered)).toBe(body.command_sha256);
    expect(
      RecoveryRequestSchema.safeParse({ ...body, command: { ...body.command, id: actor } }).success,
    ).toBe(false);
    expect(
      commandFingerprint({ ...body.command, payload: { ...body.command.payload, quantity: '2' } }),
    ).not.toBe(body.command_sha256);
  });
  it('requires authentication for request, receipt and review', async () => {
    const { app, repository } = fixture();
    await request(app).post('/sync/investment-recoveries').send(body).expect(401);
    await request(app).get(`/sync/investment-recoveries/${actor}`).expect(401);
    await request(app)
      .post(`/sync/investment-recoveries/${actor}/review`)
      .send({ decision: 'CANCELLED', reason: 'Test' })
      .expect(401);
    expect(repository.requestRecovery).not.toHaveBeenCalled();
    expect(repository.reviewRecovery).not.toHaveBeenCalled();
  });
  it('binds input to authenticated actor and rejects owner/status injection and malformed IDs', async () => {
    const { app, repository, receipt } = fixture();
    const response = await request(app)
      .post('/sync/investment-recoveries')
      .set('Authorization', 'Bearer fixture')
      .send(body)
      .expect(200);
    expect(response.body.data).toEqual(receipt);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(repository.requestRecovery).toHaveBeenCalledWith(actor, body);
    await request(app)
      .post('/sync/investment-recoveries')
      .set('Authorization', 'Bearer fixture')
      .send({ ...body, user_id: actor, status: 'CANCELLED' })
      .expect(422);
    await request(app)
      .get('/sync/investment-recoveries/invalid')
      .set('Authorization', 'Bearer fixture')
      .expect(422);
    expect(repository.requestRecovery).toHaveBeenCalledOnce();
  });
  it('forwards review to current database authorization and preserves owner-scoped receipt failures', async () => {
    const { app, repository } = fixture();
    await request(app)
      .post(`/sync/investment-recoveries/${body.command.entity_id}/review`)
      .set('Authorization', 'Bearer fixture')
      .send({ decision: 'CANCELLED', reason: 'Verified' })
      .expect(403);
    expect(repository.reviewRecovery).toHaveBeenCalledWith(actor, body.command.entity_id, {
      decision: 'CANCELLED',
      reason: 'Verified',
    });
    repository.recoveryReceipt.mockRejectedValueOnce(
      new AppError({ statusCode: 404, code: 'MISSING', message: 'Tidak ditemukan.' }),
    );
    await request(app)
      .get(`/sync/investment-recoveries/${body.command.entity_id}`)
      .set('Authorization', 'Bearer fixture')
      .expect(404);
    await request(app)
      .post(`/sync/investment-recoveries/${body.command.entity_id}/review`)
      .set('Authorization', 'Bearer fixture')
      .send({ decision: 'CANCELLED', reason: '' })
      .expect(422);
  });
  it('registers all recovery routes with strict contracts and authorization/conflict responses', () => {
    const registry = new OpenAPIRegistry();
    registerSyncOpenApi(registry);
    const document = new OpenApiGeneratorV31(registry.definitions).generateDocument({
      openapi: '3.1.0',
      info: { title: 'Test', version: '1' },
    });
    for (const [path, method] of [
      ['/api/v1/sync/investment-recoveries', 'post'],
      ['/api/v1/sync/investment-recoveries/{tradeId}', 'get'],
      ['/api/v1/sync/investment-recoveries/{tradeId}/review', 'post'],
    ] as const) {
      const operation = document.paths?.[path]?.[method];
      expect(operation?.security).toEqual([{ bearerAuth: [] }]);
      expect(operation?.responses).toHaveProperty('403');
      expect(operation?.responses).toHaveProperty('409');
    }
  });
});
