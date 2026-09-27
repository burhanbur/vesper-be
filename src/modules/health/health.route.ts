import { Router } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import { sendSuccess } from '../../common/http/api-response.js';

export type HealthDependencies = {
  checkDatabase: () => Promise<void>;
  checkRedis: () => Promise<void>;
  isShuttingDown: () => boolean;
};

export function createHealthRouter(dependencies: HealthDependencies): Router {
  const router = Router();

  router.get('/live', (request, response) => {
    sendSuccess(request, response, {
      data: { status: 'ok' },
      message: 'Layanan aktif.',
    });
  });

  router.get('/ready', async (request, response) => {
    try {
      if (dependencies.isShuttingDown()) {
        throw new Error('Application is shutting down');
      }

      await Promise.all([dependencies.checkDatabase(), dependencies.checkRedis()]);
      sendSuccess(request, response, {
        data: { status: 'ready', database: 'up', redis: 'up' },
        message: 'Layanan siap menerima permintaan.',
      });
    } catch (error) {
      throw new AppError({
        statusCode: 503,
        code: 'SERVICE_NOT_READY',
        message: 'Layanan belum siap menerima permintaan.',
        cause: error,
      });
    }
  });

  return router;
}
