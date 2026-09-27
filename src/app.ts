import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { AppError } from './common/errors/app-error.js';
import { apiRateLimit } from './common/middleware/rate-limit.js';
import { errorHandler } from './common/middleware/error-handler.js';
import { notFound } from './common/middleware/not-found.js';
import { requestId } from './common/middleware/request-id.js';
import { requestLogger } from './common/middleware/request-logger.js';
import { config } from './config/index.js';
import { mountApiDocs } from './docs/swagger.js';
import { RedisAuthSessionStore } from './infrastructure/cache/redis-auth-session.store.js';
import { checkRedisConnection, redis } from './infrastructure/cache/redis.js';
import { checkDatabaseConnection, prisma } from './infrastructure/database/prisma.js';
import { isShuttingDown } from './infrastructure/lifecycle.js';
import type { FileStorage } from './infrastructure/storage/file-storage.js';
import { LocalFileStorage } from './infrastructure/storage/local-file-storage.js';
import { createAuthRouter, createAuthService } from './modules/auth/auth.route.js';
import type { AuthSessionStore } from './modules/auth/auth-session.store.js';
import {
  PrismaAuthUserRepository,
  type AuthUserRepository,
} from './modules/auth/auth-user.repository.js';
import {
  PrismaAuthorizationRepository,
  type AuthorizationRepository,
} from './modules/authorization/authorization.repository.js';
import { PrismaFileRepository, type FileRepository } from './modules/files/file.repository.js';
import { createFileRouter } from './modules/files/file.route.js';
import { createHealthRouter, type HealthDependencies } from './modules/health/health.route.js';
import { PrismaUserRepository, type UserRepository } from './modules/users/user.repository.js';
import { createUserRouter } from './modules/users/user.route.js';

export type AppDependencies = {
  userRepository: UserRepository;
  health: HealthDependencies;
  authRepository: AuthUserRepository;
  authSessionStore: AuthSessionStore;
  authorizationRepository: AuthorizationRepository;
  fileRepository?: FileRepository;
  fileStorage?: FileStorage;
};

function defaultDependencies(): AppDependencies {
  return {
    userRepository: new PrismaUserRepository(prisma),
    authRepository: new PrismaAuthUserRepository(prisma),
    authSessionStore: new RedisAuthSessionStore(redis),
    authorizationRepository: new PrismaAuthorizationRepository(prisma),
    fileRepository: new PrismaFileRepository(prisma),
    fileStorage: new LocalFileStorage(config.FILE_STORAGE_PATH),
    health: {
      checkDatabase: checkDatabaseConnection,
      checkRedis: checkRedisConnection,
      isShuttingDown,
    },
  };
}

export function createApp(dependencies: AppDependencies = defaultDependencies()): Express {
  const app = express();

  app.set('trust proxy', config.TRUST_PROXY);
  app.disable('x-powered-by');
  app.use(requestId);
  app.use(requestLogger);
  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || config.corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(
          new AppError({
            statusCode: 403,
            code: 'CORS_ORIGIN_DENIED',
            message: 'Origin tidak diizinkan.',
          }),
        );
      },
      credentials: false,
    }),
  );
  app.use(express.json({ limit: config.BODY_LIMIT_BYTES }));
  app.use(express.urlencoded({ extended: false, limit: config.BODY_LIMIT_BYTES }));

  mountApiDocs(app);
  app.use('/health', createHealthRouter(dependencies.health));
  app.use('/api/v1', apiRateLimit);

  const authService = createAuthService(
    dependencies.authRepository,
    dependencies.authSessionStore,
    config,
  );
  app.use('/api/v1/auth', createAuthRouter(authService, config));
  app.use(
    '/api/v1/users',
    createUserRouter(
      dependencies.userRepository,
      authService,
      dependencies.authorizationRepository,
    ),
  );
  if (dependencies.fileRepository && dependencies.fileStorage) {
    app.use(
      '/api/v1/files',
      createFileRouter(
        dependencies.fileRepository,
        dependencies.fileStorage,
        authService,
        dependencies.authorizationRepository,
      ),
    );
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
