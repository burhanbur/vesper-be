import type { RequestHandler } from 'express';
import { sendSuccess } from '../../common/http/api-response.js';
import type { ValidatedInput } from '../../common/middleware/validate.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import type { CreateTransferInput } from './transfer.schema.js';
import type { TransferService } from './transfer.service.js';

export function createTransferController(service: TransferService) {
  const create: RequestHandler = async (request, response) => {
    // Authentication and validation middleware establish these typed locals.
    const principal = response.locals.auth as AuthPrincipal;
    const validated = response.locals.validated as ValidatedInput;
    const data = await service.create(principal.id, validated.body as CreateTransferInput);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, { data, statusCode: 201, message: 'Transfer berhasil dibuat.' });
  };
  return { create };
}
