import type { RequestHandler } from 'express';
import { sendSuccess } from '../../common/http/api-response.js';
import type { ValidatedInput } from '../../common/middleware/validate.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import type {
  CreateTransactionInput,
  DeleteTransactionQuery,
  ListTransactionsQuery,
  TransactionIdParams,
  UpdateTransactionInput,
} from './transaction.schema.js';
import type { TransactionService } from './transaction.service.js';

export function createTransactionController(service: TransactionService) {
  // Authentication and validation middleware establish these typed locals.
  const list: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const validated = response.locals.validated as ValidatedInput;
    const result = await service.list(principal.id, validated.query as ListTransactionsQuery);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, {
      data: result.items,
      pagination: result.pagination,
      message: 'Transaksi berhasil diambil.',
    });
  };
  const create: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const validated = response.locals.validated as ValidatedInput;
    const data = await service.create(principal.id, validated.body as CreateTransactionInput);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, {
      data,
      statusCode: 201,
      message: 'Transaksi berhasil dibuat.',
    });
  };
  const update: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const validated = response.locals.validated as ValidatedInput;
    const { id } = validated.params as TransactionIdParams;
    const data = await service.update(principal.id, id, validated.body as UpdateTransactionInput);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, { data, message: 'Transaksi berhasil diperbarui.' });
  };
  const remove: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const validated = response.locals.validated as ValidatedInput;
    const { id } = validated.params as TransactionIdParams;
    const { version } = validated.query as DeleteTransactionQuery;
    await service.delete(principal.id, id, version);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, { data: null, message: 'Transaksi berhasil dihapus.' });
  };
  return { list, create, update, remove };
}
