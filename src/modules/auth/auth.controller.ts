import type { RequestHandler } from 'express';
import { sendSuccess } from '../../common/http/api-response.js';
import type { ValidatedInput } from '../../common/middleware/validate.js';
import { readBearerToken } from './auth.middleware.js';
import type { LoginInput, RefreshTokenInput, RegisterInput } from './auth.schema.js';
import type { AuthService } from './auth.service.js';
import type { AuthPrincipal, AuthResult } from './auth.types.js';

function validated(responseLocals: Record<string, unknown>): ValidatedInput {
  return responseLocals.validated as ValidatedInput;
}

function authResponse(result: AuthResult) {
  return {
    user: result.user,
    access_token: result.tokens.accessToken,
    refresh_token: result.tokens.refreshToken,
    token_type: 'Bearer' as const,
    expires_at: result.tokens.accessExpiresAt.toISOString(),
    refresh_expires_at: result.tokens.refreshExpiresAt.toISOString(),
  };
}

export function createAuthController(service: AuthService) {
  const register: RequestHandler = async (request, response) => {
    const input = validated(response.locals).body as RegisterInput;
    const result = await service.register(input);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, {
      statusCode: 201,
      data: authResponse(result),
      message: 'Registrasi berhasil.',
    });
  };

  const login: RequestHandler = async (request, response) => {
    const input = validated(response.locals).body as LoginInput;
    const result = await service.login(input);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, {
      data: authResponse(result),
      message: 'Berhasil masuk.',
    });
  };

  const refresh: RequestHandler = async (request, response) => {
    const input = validated(response.locals).body as RefreshTokenInput;
    const result = await service.refresh(input.refresh_token);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, {
      data: authResponse(result),
      message: 'Sesi berhasil diperbarui.',
    });
  };

  const logout: RequestHandler = async (request, response) => {
    await service.logout(readBearerToken(request));
    sendSuccess(request, response, {
      data: null,
      message: 'Berhasil keluar.',
    });
  };

  const me: RequestHandler = (request, response) => {
    const principal = response.locals.auth as AuthPrincipal;
    sendSuccess(request, response, {
      data: {
        id: principal.id,
        name: principal.name,
        email: principal.email,
        status: principal.status,
        roles: principal.roles,
      },
      message: 'Data pengguna terautentikasi berhasil diambil.',
    });
  };

  return { register, login, refresh, logout, me };
}
