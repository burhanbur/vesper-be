import type { RequestHandler } from 'express';
import { sendSuccess } from '../../common/http/api-response.js';
import type { ValidatedInput } from '../../common/middleware/validate.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import type { CreateBudgetInput, ListBudgetsQuery, UpdateBudgetInput } from './budget.schema.js';
import type { BudgetService } from './budget.service.js';

export function createBudgetController(service: BudgetService) {
  // Authentication and validation establish these locals before controller execution.
  const list: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const input = response.locals.validated as ValidatedInput;
    const result = await service.list(principal.id, input.query as ListBudgetsQuery);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, {
      data: result.items,
      pagination: result.pagination,
      message: 'Anggaran berhasil diambil.',
    });
  };
  const create: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const input = response.locals.validated as ValidatedInput;
    const data = await service.create(principal.id, input.body as CreateBudgetInput);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, { data, statusCode: 201, message: 'Anggaran berhasil dibuat.' });
  };
  const update: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const input = response.locals.validated as ValidatedInput;
    const { id } = input.params as { id: string };
    const data = await service.update(principal.id, id, input.body as UpdateBudgetInput);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, { data, message: 'Anggaran berhasil diperbarui.' });
  };
  const remove: RequestHandler = async (_request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const input = response.locals.validated as ValidatedInput;
    const { id } = input.params as { id: string };
    await service.delete(principal.id, id);
    response.set('Cache-Control', 'no-store').status(204).end();
  };
  const progress: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const input = response.locals.validated as ValidatedInput;
    const { id } = input.params as { id: string };
    const { period } = input.query as { period: string };
    const data = await service.progress(principal.id, id, period);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, { data, message: 'Progres anggaran berhasil diambil.' });
  };
  return { list, create, update, remove, progress };
}
