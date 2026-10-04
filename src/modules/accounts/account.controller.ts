import type { RequestHandler } from 'express';
import { sendSuccess } from '../../common/http/api-response.js';
import type { ValidatedInput } from '../../common/middleware/validate.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import type {
  AccountIdParams,
  CreateAccountInput,
  DeleteAccountQuery,
  ListAccountsQuery,
  UpdateAccountInput,
} from './account.schema.js';
import type { AccountService } from './account.service.js';

export function createAccountController(service: AccountService) {
  const list: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const validated = response.locals.validated as ValidatedInput;
    const result = await service.list(principal.id, validated.query as ListAccountsQuery);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, {
      data: result.items,
      pagination: result.pagination,
      message: 'Akun berhasil diambil.',
    });
  };
  const create: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const validated = response.locals.validated as ValidatedInput;
    const data = await service.create(principal.id, validated.body as CreateAccountInput);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, { data, statusCode: 201, message: 'Akun berhasil dibuat.' });
  };
  const update: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const validated = response.locals.validated as ValidatedInput;
    const { id } = validated.params as AccountIdParams;
    const data = await service.update(principal.id, id, validated.body as UpdateAccountInput);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, { data, message: 'Akun berhasil diperbarui.' });
  };
  const remove: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const validated = response.locals.validated as ValidatedInput;
    const { id } = validated.params as AccountIdParams;
    const { version } = validated.query as DeleteAccountQuery;
    await service.delete(principal.id, id, version);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, { data: null, message: 'Akun berhasil dihapus.' });
  };
  return { list, create, update, remove };
}
