import type { RequestHandler } from 'express';
import { sendSuccess } from '../../common/http/api-response.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import type { AssetAllocationService } from './asset-allocation.service.js';

export function createAllocationHandler(service: AssetAllocationService): RequestHandler {
  return async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const data = await service.snapshot(principal.id);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, { data, message: 'Alokasi aset berhasil diambil.' });
  };
}
