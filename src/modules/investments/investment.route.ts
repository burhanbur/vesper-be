import { Router } from 'express';
import { validateRequest } from '../../common/middleware/validate.js';
import { createRequireAuthentication } from '../auth/auth.middleware.js';
import type { AuthService } from '../auth/auth.service.js';
import type { InvestmentRepository } from './investment.repository.js';
import { InvestmentService } from './investment.service.js';
import { createInvestmentController } from './investment.controller.js';
import {
  ListInstrumentsSchema,
  ListPricesSchema,
  CreateInstrumentSchema,
  CreatePriceSchema,
  CreateInvestmentSchema,
  EmptyInvestmentQuerySchema,
  InvestmentAccountParamsSchema,
  SnapshotQuerySchema,
} from './investment.schema.js';
export function createInvestmentRouter(
  repository: InvestmentRepository,
  authService: AuthService,
): Router {
  const router = Router();
  const controller = createInvestmentController(new InvestmentService(repository));
  // Attach authentication to exact routes, not the entire /api/v1 mount.
  const auth = createRequireAuthentication(authService);
  router.get(
    '/instruments',
    auth,
    validateRequest({ query: ListInstrumentsSchema }),
    controller.instruments,
  );
  router.post(
    '/instruments',
    auth,
    validateRequest({ body: CreateInstrumentSchema, query: EmptyInvestmentQuerySchema }),
    controller.createInstrument,
  );
  router.get(
    '/instrument-prices',
    auth,
    validateRequest({ query: ListPricesSchema }),
    controller.prices,
  );
  router.post(
    '/instrument-prices',
    auth,
    validateRequest({ body: CreatePriceSchema, query: EmptyInvestmentQuerySchema }),
    controller.upsertPrice,
  );
  router.post(
    '/investment-transactions',
    auth,
    validateRequest({ body: CreateInvestmentSchema, query: EmptyInvestmentQuerySchema }),
    controller.createTransaction,
  );
  router.get(
    '/accounts/:id/holdings',
    auth,
    validateRequest({ params: InvestmentAccountParamsSchema, query: EmptyInvestmentQuerySchema }),
    controller.holdings,
  );
  router.get(
    '/accounts/:id/portfolio-snapshot',
    auth,
    validateRequest({ params: InvestmentAccountParamsSchema, query: SnapshotQuerySchema }),
    controller.snapshot,
  );
  return router;
}
