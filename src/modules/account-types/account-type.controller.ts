import type { RequestHandler } from 'express';
import { sendSuccess } from '../../common/http/api-response.js';
import type { ValidatedInput } from '../../common/middleware/validate.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import type {
  AccountTypeIdParams,
  CreateAccountTypeInput,
  DeleteAccountTypeQuery,
  ListAccountTypesQuery,
  UpdateAccountTypeInput,
} from './account-type.schema.js';
import type { AccountTypeService } from './account-type.service.js';

export function createAccountTypeController(service: AccountTypeService) {
  // Authentication and route validation establish these locals before execution.
  const list: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const validated = response.locals.validated as ValidatedInput;
    const result = await service.list(principal.id, validated.query as ListAccountTypesQuery);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, {
      data: result.items,
      pagination: result.pagination,
      message: 'Tipe akun berhasil diambil.',
    });
  };
  const create: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const validated = response.locals.validated as ValidatedInput;
    const data = await service.create(principal.id, validated.body as CreateAccountTypeInput);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, {
      data,
      statusCode: 201,
      message: 'Tipe akun berhasil dibuat.',
    });
  };
  const update: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const validated = response.locals.validated as ValidatedInput;
    const { id } = validated.params as AccountTypeIdParams;
    const data = await service.update(principal.id, id, validated.body as UpdateAccountTypeInput);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, { data, message: 'Tipe akun berhasil diperbarui.' });
  };
  const remove: RequestHandler = async (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    const validated = response.locals.validated as ValidatedInput;
    const { id } = validated.params as AccountTypeIdParams;
    const { version } = validated.query as DeleteAccountTypeQuery;
    await service.delete(principal.id, id, version);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, { data: null, message: 'Tipe akun berhasil dihapus.' });
  };
  return { list, create, update, remove };
}
