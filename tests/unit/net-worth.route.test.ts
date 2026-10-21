import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/common/errors/app-error.js';
import { errorHandler } from '../../src/common/middleware/error-handler.js';
import type { AuthService } from '../../src/modules/auth/auth.service.js';
import { createNetWorthRouter } from '../../src/modules/net-worth/net-worth.route.js';
import { NetWorthDtoSchema } from '../../src/modules/net-worth/net-worth.schema.js';

vi.mock('../../src/modules/auth/auth.middleware.js', () => ({
  createRequireAuthentication:
    () => (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (req.get('authorization') !== 'Bearer session')
        return next(
          new AppError({
            statusCode: 401,
            code: 'UNAUTHENTICATED',
            message: 'Autentikasi diperlukan.',
          }),
        );
      res.locals.auth = { id: 'owner' };
      next();
    },
}));
function fixture() {
  const read = vi.fn().mockResolvedValue({ accounts: [], positions: [], instruments: [] });
  const app = express();
  const findCapture = vi.fn().mockResolvedValue(null);
  const capture = vi.fn().mockResolvedValue(undefined);
  app.use(
    '/api/v1/net-worth',
    createNetWorthRouter({ read, findCapture, capture }, {} as AuthService),
  );
  app.use(errorHandler);
  return { app, read, capture };
}
describe('net worth HTTP', () => {
  it('allocation authenticates first, uses only the principal and never captures financial history', async () => {
    const { app, read, capture } = fixture();
    await request(app).get('/api/v1/net-worth/allocation').expect(401);
    expect(read).not.toHaveBeenCalled();
    const response = await request(app)
      .get('/api/v1/net-worth/allocation')
      .set('Authorization', 'Bearer session')
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(response.body.data).toMatchObject({
      scope: 'owner',
      currency: 'IDR',
      status: 'partial',
      total_assets: null,
    });
    expect(read).toHaveBeenCalledWith('owner', 'IDR', expect.any(String));
    expect(capture).not.toHaveBeenCalled();
  });
  it.each([
    'scope=shared',
    'user_id=other',
    'currency=USD',
    'date=2026-10-21',
    'currency=IDR&currency=USD',
  ])('allocation rejects unsupported scope/query %s', async (query) => {
    const { app, read } = fixture();
    await request(app)
      .get('/api/v1/net-worth/allocation?' + query)
      .set('Authorization', 'Bearer session')
      .expect(422);
    expect(read).not.toHaveBeenCalled();
  });
  it('requires authentication before accessing data', async () => {
    const { app, read } = fixture();
    await request(app).get('/api/v1/net-worth/snapshots').expect(401);
    expect(read).not.toHaveBeenCalled();
  });
  it.each([
    'scope=shared',
    'user_id=other',
    'currency=idr',
    'date=2026-02-30',
    'currency=IDR&currency=USD',
    'date=9999-12-31',
  ])('rejects %s without a read', async (query) => {
    const { app, read } = fixture();
    await request(app)
      .get('/api/v1/net-worth/snapshots?' + query)
      .set('Authorization', 'Bearer session')
      .expect(422);
    expect(read).not.toHaveBeenCalled();
  });
  it('uses the principal and single currency, standard envelope and no-store', async () => {
    const { app, read } = fixture();
    const response = await request(app)
      .get('/api/v1/net-worth/snapshots?currency=USD')
      .set('Authorization', 'Bearer session')
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(response.body).toMatchObject({
      success: true,
      total_data: 1,
      data: { scope: 'owner', currency: 'USD', net_worth: null, known_net_worth: '0.00' },
    });
    expect(NetWorthDtoSchema.safeParse(response.body.data).success).toBe(true);
    expect(read).toHaveBeenCalledWith('owner', 'USD', expect.any(String));
  });
  it('returns historical unavailable rather than reconstructed zero', async () => {
    const { app, read } = fixture();
    const response = await request(app)
      .get('/api/v1/net-worth/snapshots?date=2020-01-01')
      .set('Authorization', 'Bearer session')
      .expect(200);
    expect(response.body.data).toMatchObject({
      status: 'unavailable',
      known_assets: null,
      known_net_worth: null,
      accounts: [],
      holdings: [],
    });
    expect(read).not.toHaveBeenCalled();
  });
});
