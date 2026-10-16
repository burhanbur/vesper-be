import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/common/errors/app-error.js';
import { errorHandler } from '../../src/common/middleware/error-handler.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import type { AuthService } from '../../src/modules/auth/auth.service.js';
import { createDashboardRouter } from '../../src/modules/dashboard/dashboard.route.js';

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
      res.locals.auth = { id: 'authenticated-user' };
      next();
    },
}));

function fixture() {
  const summarize = vi.fn(async () => ({
    income: new Prisma.Decimal(20),
    expense: new Prisma.Decimal(5),
  }));
  const app = express();
  // Authentication is faked at its boundary; real routing, validation and service are exercised.
  app.use('/api/v1/dashboard', createDashboardRouter({ summarize }, {} as AuthService));
  app.use(errorHandler);
  return { app, summarize };
}

describe('dashboard HTTP summary', () => {
  it('requires authentication before computing a summary', async () => {
    const { app, summarize } = fixture();
    await request(app).get('/api/v1/dashboard/summary?period=yearly&value=2026').expect(401);
    expect(summarize).not.toHaveBeenCalled();
  });

  it.each([
    'period=daily&value=2026-02-30',
    'period=monthly&value=2026-10&unknown=1',
    'period=yearly&value=2026&value=2027',
    'period=yearly',
    'period=daily&value=2026-02-01&end_value=2026-02-30',
    'period=monthly&value=2026-10&end_value=2026-11-01',
    'period=yearly&value=2026&end_value=2025',
    'period=yearly&value=2026&end_value=2026&end_value=2027',
    'period=yearly&value=2026&end_value=',
  ])('rejects invalid HTTP query %s before repository access', async (query) => {
    const { app, summarize } = fixture();
    await request(app)
      .get(`/api/v1/dashboard/summary?${query}`)
      .set('Authorization', 'Bearer test-session')
      .expect(422);
    expect(summarize).not.toHaveBeenCalled();
  });

  it('returns a resolved inclusive ending period and passes exclusive WIB bounds to the repository', async () => {
    const { app, summarize } = fixture();
    const response = await request(app)
      .get('/api/v1/dashboard/summary?period=monthly&value=2026-10&end_value=2026-12')
      .set('Authorization', 'Bearer test-session')
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(response.body.data).toMatchObject({
      period: 'monthly',
      value: '2026-10',
      end_value: '2026-12',
      start_at: '2026-09-30T17:00:00.000Z',
      end_at: '2026-12-31T17:00:00.000Z',
      income_total: '20.00',
      expense_total: '5.00',
      net_cashflow: '15.00',
    });
    expect(summarize).toHaveBeenCalledExactlyOnceWith(
      'authenticated-user',
      new Date('2026-09-30T17:00:00.000Z'),
      new Date('2026-12-31T17:00:00.000Z'),
    );
  });

  it('returns the standard envelope with decimal strings and no-store', async () => {
    const { app, summarize } = fixture();
    const response = await request(app)
      .get('/api/v1/dashboard/summary?period=daily&value=2024-02-29')
      .set('Authorization', 'Bearer test-session')
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(response.body).toMatchObject({
      success: true,
      total_data: 1,
      data: {
        period: 'daily',
        value: '2024-02-29',
        end_value: '2024-02-29',
        timezone: 'Asia/Jakarta',
        start_at: '2024-02-28T17:00:00.000Z',
        end_at: '2024-02-29T17:00:00.000Z',
        income_total: '20.00',
        expense_total: '5.00',
        net_cashflow: '15.00',
      },
    });
    expect(summarize).toHaveBeenCalledExactlyOnceWith(
      'authenticated-user',
      new Date('2024-02-28T17:00:00.000Z'),
      new Date('2024-02-29T17:00:00.000Z'),
    );
  });
});
