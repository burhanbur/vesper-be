import type { RequestHandler } from 'express';
import { sendSuccess } from '../../common/http/api-response.js';
import type { ValidatedInput } from '../../common/middleware/validate.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import type { z } from '../../common/openapi/zod.js';
import type { ObligationHttpCommandSchema } from './obligation.schema.js';
import type { ObligationRepository } from './obligation.repository.js';

export function createObligationController(repository: ObligationRepository) {
  const list: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const data = await repository.list(principal.id);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, { data });
  };
  const events: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const input = response.locals.validated as ValidatedInput;
    const data = await repository.events(principal.id, (input.params as { id: string }).id);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, { data });
  };
  const command: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const input = response.locals.validated as ValidatedInput;
    const body = input.body as z.infer<typeof ObligationHttpCommandSchema>;
    const data = await repository.apply(principal.id, body.id, body.command);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, { data, message: 'Catatan utang/piutang tersimpan.' });
  };
  return { list, events, command };
}
