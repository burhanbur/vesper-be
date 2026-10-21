import { Router, type RequestHandler } from 'express';
import { sendSuccess } from '../../common/http/api-response.js';
import { validateRequest, type ValidatedInput } from '../../common/middleware/validate.js';
import { createRequireAuthentication } from '../auth/auth.middleware.js';
import type { AuthService } from '../auth/auth.service.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import type { NetWorthRepository } from './net-worth.repository.js';
import { NetWorthQuerySchema, type NetWorthQuery } from './net-worth.schema.js';
import { NetWorthService } from './net-worth.service.js';
import { AllocationQuerySchema } from '../asset-allocation/asset-allocation.schema.js';
import { AssetAllocationService } from '../asset-allocation/asset-allocation.service.js';
import { createAllocationHandler } from '../asset-allocation/asset-allocation.controller.js';

export function createNetWorthRouter(
  repository: NetWorthRepository,
  authService: AuthService,
): Router {
  const router = Router();
  const service = new NetWorthService(repository);
  const snapshot: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const input = response.locals.validated as ValidatedInput;
    const data = await service.snapshot(principal.id, input.query as NetWorthQuery);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, { data, message: 'Snapshot kekayaan berhasil diambil.' });
  };
  router.use(createRequireAuthentication(authService));
  router.get(
    '/allocation',
    validateRequest({ query: AllocationQuerySchema }),
    createAllocationHandler(new AssetAllocationService(repository)),
  );
  router.get('/snapshots', validateRequest({ query: NetWorthQuerySchema }), snapshot);
  return router;
}
