import type { RequestHandler } from 'express';
import { sendSuccess } from '../../common/http/api-response.js';
import type { ValidatedInput } from '../../common/middleware/validate.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import type { PatchProfileInput } from './profile.schema.js';
import type { ProfileService } from './profile.service.js';

export function createProfileController(service: ProfileService) {
  const get: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, {
      data: await service.get(principal.id),
      message: 'Profil berhasil diambil.',
    });
  };
  const patch: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    // The route middleware validates this body before the controller executes.
    const validated = response.locals.validated as ValidatedInput;
    const input = validated.body as PatchProfileInput;
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, {
      data: await service.patch(principal.id, input),
      message: 'Profil berhasil diperbarui.',
    });
  };
  return { get, patch };
}
