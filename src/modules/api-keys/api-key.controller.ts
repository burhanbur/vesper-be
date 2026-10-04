import type { RequestHandler } from 'express';
import { sendSuccess } from '../../common/http/api-response.js';
import type { ValidatedInput } from '../../common/middleware/validate.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import type { CreateApiKeyInput, ListApiKeysQuery, UpdateApiKeyInput } from './api-key.schema.js';
import type { ApiKeyService } from './api-key.service.js';
import type { ApiKeyPrincipal } from './api-key.types.js';

function validated(responseLocals: Record<string, unknown>): ValidatedInput {
  return responseLocals.validated as ValidatedInput;
}

function currentUserId(responseLocals: Record<string, unknown>): string | null {
  const auth = responseLocals.auth as AuthPrincipal | undefined;
  return auth?.id ?? null;
}

export function createApiKeyController(service: ApiKeyService) {
  const list: RequestHandler = async (request, response) => {
    const query = validated(response.locals).query as ListApiKeysQuery;
    const result = await service.list(query);
    sendSuccess(request, response, {
      data: result.items,
      pagination: result.pagination,
      message: 'Daftar API Key berhasil diambil.',
    });
  };

  const create: RequestHandler = async (request, response) => {
    const input = validated(response.locals).body as CreateApiKeyInput;
    const userId = currentUserId(response.locals);
    const result = await service.create(userId, input);
    sendSuccess(request, response, {
      statusCode: 201,
      data: result,
      message: 'API Key berhasil dibuat. Simpan kunci ini karena tidak akan ditampilkan lagi.',
    });
  };

  const getById: RequestHandler = async (request, response) => {
    const params = validated(response.locals).params as { id: string };
    const result = await service.getById(params.id);
    sendSuccess(request, response, {
      data: result,
      message: 'Detail API Key berhasil diambil.',
    });
  };

  const update: RequestHandler = async (request, response) => {
    const params = validated(response.locals).params as { id: string };
    const input = validated(response.locals).body as UpdateApiKeyInput;
    const userId = currentUserId(response.locals);
    const result = await service.update(params.id, userId, input);
    sendSuccess(request, response, {
      data: result,
      message: 'API Key berhasil diperbarui.',
    });
  };

  const remove: RequestHandler = async (request, response) => {
    const params = validated(response.locals).params as { id: string };
    await service.delete(params.id);
    sendSuccess(request, response, {
      data: null,
      message: 'API Key berhasil dihapus.',
    });
  };

  const verifyM2m: RequestHandler = (request, response) => {
    const principal = response.locals.apiKey as ApiKeyPrincipal;
    sendSuccess(request, response, {
      data: {
        id: principal.id,
        name: principal.name,
        application: principal.application,
        permissions: principal.permissions,
        authenticated: true as const,
      },
      message: 'Autentikasi API Key machine-to-machine berhasil.',
    });
  };

  return { list, create, getById, update, remove, verifyM2m };
}
