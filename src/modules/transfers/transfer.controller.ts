import type { RequestHandler } from 'express';
import { sendSuccess } from '../../common/http/api-response.js';
import type { ValidatedInput } from '../../common/middleware/validate.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import type { CreateTransferInput, UpdateTransferInput } from './transfer.schema.js';
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

  const update: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const validated = response.locals.validated as ValidatedInput;
    const { id } = validated.params as { id: string };
    const { version, ...input } = validated.body as UpdateTransferInput;
    const data = await service.update(principal.id, id, version, input);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, { data, statusCode: 200, message: 'Transfer berhasil diperbarui.' });
  };

  const remove: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const validated = response.locals.validated as ValidatedInput;
    const { id } = validated.params as { id: string };
    const { version } = (validated.query ?? {}) as { version?: string };
    const data = await service.delete(principal.id, id, version);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, { data, statusCode: 200, message: 'Transfer berhasil dihapus.' });
  };

  return { create, update, remove };
}
