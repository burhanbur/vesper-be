import type { RequestHandler } from 'express';
import { sendSuccess } from '../../common/http/api-response.js';
import type { ValidatedInput } from '../../common/middleware/validate.js';
import type { CreateUserInput, ListUsersQuery, UpdateUserInput } from './user.schema.js';
import type { UserService } from './user.service.js';

type UserIdParams = { id: string };

function validated(responseLocals: Record<string, unknown>): ValidatedInput {
  return responseLocals.validated as ValidatedInput;
}

export function createUserController(service: UserService) {
  const list: RequestHandler = async (request, response) => {
    const query = validated(response.locals).query as ListUsersQuery;
    const result = await service.list(query);
    sendSuccess(request, response, {
      data: result.users,
      message: 'Data pengguna berhasil diambil.',
      totalData: result.users.length,
      pagination: result.pagination,
    });
  };

  const show: RequestHandler = async (request, response) => {
    const { id } = validated(response.locals).params as UserIdParams;
    const user = await service.getById(id);
    sendSuccess(request, response, { data: user, message: 'Data pengguna berhasil diambil.' });
  };

  const create: RequestHandler = async (request, response) => {
    const body = validated(response.locals).body as CreateUserInput;
    const user = await service.create(body);
    sendSuccess(request, response, {
      data: user,
      message: 'Pengguna berhasil dibuat.',
      statusCode: 201,
    });
  };

  const update: RequestHandler = async (request, response) => {
    const { id } = validated(response.locals).params as UserIdParams;
    const body = validated(response.locals).body as UpdateUserInput;
    const user = await service.update(id, body);
    sendSuccess(request, response, { data: user, message: 'Pengguna berhasil diperbarui.' });
  };

  const remove: RequestHandler = async (request, response) => {
    const { id } = validated(response.locals).params as UserIdParams;
    await service.delete(id);
    sendSuccess(request, response, {
      data: null,
      message: 'Pengguna berhasil dihapus.',
    });
  };

  return { list, show, create, update, remove };
}
