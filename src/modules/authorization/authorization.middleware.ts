import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import type { AuthorizationRepository } from './authorization.repository.js';

function authenticationRequired(): AppError {
  return new AppError({
    statusCode: 401,
    code: 'AUTHENTICATION_REQUIRED',
    message: 'Autentikasi diperlukan untuk mengakses sumber daya ini.',
  });
}

export function requirePermission(
  repository: AuthorizationRepository,
  permissionName: string,
): RequestHandler {
  return async (_request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const principal = response.locals.auth as AuthPrincipal | undefined;
      if (!principal) {
        next(authenticationRequired());
        return;
      }

      if (!(await repository.hasPermission(principal.id, permissionName))) {
        next(
          new AppError({
            statusCode: 403,
            code: 'AUTHORIZATION_DENIED',
            message: 'Anda tidak memiliki izin untuk melakukan tindakan ini.',
          }),
        );
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
