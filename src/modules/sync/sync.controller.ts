import type { RequestHandler } from 'express';
import { sendSuccess } from '../../common/http/api-response.js';
import type { ValidatedInput } from '../../common/middleware/validate.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import type { PullQuery, PushBody } from './sync.schema.js';
import type { SyncService } from './sync.service.js';

export function createSyncController(service: SyncService) {
  const pull: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const input = response.locals.validated as ValidatedInput;
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, {
      data: await service.pull(principal.id, input.query as PullQuery),
      message: 'Perubahan berhasil diambil.',
    });
  };
  const push: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const input = response.locals.validated as ValidatedInput;
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, {
      data: await service.push(principal.id, input.body as PushBody),
      message: 'Perubahan berhasil diproses.',
    });
  };
  return { pull, push };
}
