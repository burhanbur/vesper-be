import cors from 'cors';
import {
  PrismaNotificationRepository,
  type NotificationRepository,
} from './modules/notifications/notification.repository.js';
import { createNotificationRouter } from './modules/notifications/notification.route.js';
import { syncClient } from './infrastructure/database/sync-publication.js';
import { SyncRepository } from './modules/sync/sync.repository.js';
import { createSyncRouter } from './modules/sync/sync.route.js';
import { PrismaGroupRepository, type GroupRepository } from './modules/groups/group.repository.js';
import { createGroupRouter } from './modules/groups/group.route.js';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { AppError } from './common/errors/app-error.js';
import { errorHandler } from './common/middleware/error-handler.js';
import { notFound } from './common/middleware/not-found.js';
import { apiRateLimit } from './common/middleware/rate-limit.js';
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
import {
  PrismaProfileRepository,
  type ProfileRepository,
} from './modules/profiles/profile.repository.js';
import { createProfileRouter } from './modules/profiles/profile.route.js';
import {
  PrismaDeviceRepository,
  type DeviceRepository,
} from './modules/devices/device.repository.js';
import { createDeviceRouter } from './modules/devices/device.route.js';
import {
  PrismaAccountTypeRepository,
  type AccountTypeRepository,
} from './modules/account-types/account-type.repository.js';
import { createAccountTypeRouter } from './modules/account-types/account-type.route.js';
import {
  PrismaAccountRepository,
  type AccountRepository,
} from './modules/accounts/account.repository.js';
import { createAccountRouter } from './modules/accounts/account.route.js';
import {
  PrismaCategoryRepository,
  type CategoryRepository,
} from './modules/categories/category.repository.js';
import { createCategoryRouter } from './modules/categories/category.route.js';
import {
  PrismaTransactionRepository,
  type TransactionRepository,
} from './modules/transactions/transaction.repository.js';
import { createTransactionRouter } from './modules/transactions/transaction.route.js';
import {
  PrismaTransferRepository,
  type TransferRepository,
} from './modules/transfers/transfer.repository.js';
import { createTransferRouter } from './modules/transfers/transfer.route.js';
import {
  PrismaBudgetRepository,
  type BudgetRepository,
} from './modules/budgets/budget.repository.js';
import { createBudgetRouter } from './modules/budgets/budget.route.js';
import {
  PrismaInvestmentRepository,
  type InvestmentRepository,
} from './modules/investments/investment.repository.js';
import { createInvestmentRouter } from './modules/investments/investment.route.js';
import {
  PrismaApiKeyRepository,
  type ApiKeyRepository,
} from './modules/api-keys/api-key.repository.js';
import { createApiKeyRouter } from './modules/api-keys/api-key.route.js';

export type AppDependencies = {
  userRepository: UserRepository;
  health: HealthDependencies;
  authRepository: AuthUserRepository;
  authSessionStore: AuthSessionStore;
  authorizationRepository: AuthorizationRepository;
  fileRepository?: FileRepository;
  fileStorage?: FileStorage;
  profileRepository?: ProfileRepository;
  deviceRepository?: DeviceRepository;
  accountTypeRepository?: AccountTypeRepository;
  accountRepository?: AccountRepository;
  categoryRepository?: CategoryRepository;
  transactionRepository?: TransactionRepository;
  transferRepository?: TransferRepository;
  budgetRepository?: BudgetRepository;
  investmentRepository?: InvestmentRepository;
  groupRepository?: GroupRepository;
  syncRepository?: SyncRepository;
  notificationRepository?: NotificationRepository;
  apiKeyRepository?: ApiKeyRepository;
};

function defaultDependencies(): AppDependencies {
  const synced = syncClient(prisma);
  return {
    apiKeyRepository: new PrismaApiKeyRepository(prisma),
    notificationRepository: new PrismaNotificationRepository(prisma),
    syncRepository: new SyncRepository(prisma),
    userRepository: new PrismaUserRepository(prisma),
    authRepository: new PrismaAuthUserRepository(prisma),
    authSessionStore: new RedisAuthSessionStore(redis),
    authorizationRepository: new PrismaAuthorizationRepository(prisma),
    fileRepository: new PrismaFileRepository(prisma),
    fileStorage: new LocalFileStorage(config.FILE_STORAGE_PATH),
    profileRepository: new PrismaProfileRepository(synced),
    deviceRepository: new PrismaDeviceRepository(prisma),
    accountTypeRepository: new PrismaAccountTypeRepository(synced),
    accountRepository: new PrismaAccountRepository(synced),
    categoryRepository: new PrismaCategoryRepository(synced),
    transactionRepository: new PrismaTransactionRepository(synced),
    transferRepository: new PrismaTransferRepository(synced),
    budgetRepository: new PrismaBudgetRepository(prisma),
    investmentRepository: new PrismaInvestmentRepository(syncClient(prisma, null, false)),
    groupRepository: new PrismaGroupRepository(synced),
    health: {
      checkDatabase: checkDatabaseConnection,
      checkRedis: checkRedisConnection,
      isShuttingDown,
    },
  };
}

export function createApp(dependencies: AppDependencies = defaultDependencies()): Express {
  const app = express();

  // Apply shared request handling before any routes.
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

  // Keep documentation and health checks outside the API rate limit.
  mountApiDocs(app);
  app.use('/health', createHealthRouter(dependencies.health));
  app.use('/api/v1', apiRateLimit);

  // Share the same authentication service across protected feature routers.
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

  if (dependencies.profileRepository) {
    app.use('/api/v1/me', createProfileRouter(dependencies.profileRepository, authService));
  }
  if (dependencies.deviceRepository) {
    app.use('/api/v1/devices', createDeviceRouter(dependencies.deviceRepository, authService));
  }
  if (dependencies.accountTypeRepository) {
    app.use(
      '/api/v1/account-types',
      createAccountTypeRouter(dependencies.accountTypeRepository, authService),
    );
  }

  if (dependencies.accountRepository) {
    app.use('/api/v1/accounts', createAccountRouter(dependencies.accountRepository, authService));
  }

  if (dependencies.categoryRepository) {
    app.use(
      '/api/v1/categories',
      createCategoryRouter(dependencies.categoryRepository, authService),
    );
  }

  if (dependencies.transactionRepository) {
    app.use(
      '/api/v1/transactions',
      createTransactionRouter(dependencies.transactionRepository, authService),
    );
  }

  if (dependencies.transferRepository) {
    app.use(
      '/api/v1/transfers',
      createTransferRouter(dependencies.transferRepository, authService),
    );
  }

  if (dependencies.budgetRepository) {
    app.use('/api/v1/budgets', createBudgetRouter(dependencies.budgetRepository, authService));
  }

  if (dependencies.investmentRepository) {
    app.use('/api/v1', createInvestmentRouter(dependencies.investmentRepository, authService));
  }

  if (dependencies.groupRepository) {
    app.use('/api/v1/groups', createGroupRouter(dependencies.groupRepository, authService));
  }

  if (dependencies.syncRepository) {
    app.use('/api/v1/sync', createSyncRouter(dependencies.syncRepository, authService));
  }

  if (dependencies.notificationRepository) {
    app.use(
      '/api/v1/notifications',
      createNotificationRouter(dependencies.notificationRepository, authService),
    );
  }

  if (dependencies.apiKeyRepository) {
    app.use('/api/v1/api-keys', createApiKeyRouter(dependencies.apiKeyRepository, authService));
  }

  // Handle unmatched routes and errors only after all routers are mounted.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
