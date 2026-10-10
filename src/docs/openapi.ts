import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import {
  createSuccessResponseSchema,
  ErrorResponseSchema,
} from '../common/contracts/api-response.schema.js';
import { z } from '../common/openapi/zod.js';
import {
  AuthPayloadDtoSchema,
  AuthUserDtoSchema,
  LoginSchema,
  RefreshTokenSchema,
  RegisterSchema,
} from '../modules/auth/auth.schema.js';
import {
  FileDtoSchema,
  FileIdParamsSchema,
  ListFilesQuerySchema,
} from '../modules/files/file.schema.js';
import { UserImportResultSchema } from '../modules/users/user-excel.schema.js';
import {
  CreateUserSchema,
  ListUsersQuerySchema,
  UpdateUserSchema,
  UserDtoSchema,
  UserIdParamsSchema,
} from '../modules/users/user.schema.js';

import { registerProfileOpenApi } from '../modules/profiles/profile.openapi.js';
import { registerDeviceOpenApi } from '../modules/devices/device.openapi.js';
import { registerAccountTypeOpenApi } from '../modules/account-types/account-type.openapi.js';
import { registerAccountOpenApi } from '../modules/accounts/account.openapi.js';
import { registerCategoryOpenApi } from '../modules/categories/category.openapi.js';
import { registerTransactionOpenApi } from '../modules/transactions/transaction.openapi.js';
import { registerTransferOpenApi } from '../modules/transfers/transfer.openapi.js';
import { registerBudgetOpenApi } from '../modules/budgets/budget.openapi.js';
import { registerInvestmentOpenApi } from '../modules/investments/investment.openapi.js';
import { registerGroupOpenApi } from '../modules/groups/group.openapi.js';

import { registerSyncOpenApi } from '../modules/sync/sync.openapi.js';
import { registerNotificationOpenApi } from '../modules/notifications/notification.openapi.js';
import { registerApiKeyOpenApi } from '../modules/api-keys/api-key.openapi.js';
import { registerReferenceOpenApi } from '../modules/references/reference.openapi.js';

const registry = new OpenAPIRegistry();
registerReferenceOpenApi(registry);
registerApiKeyOpenApi(registry);
registerNotificationOpenApi(registry);
registerSyncOpenApi(registry);
registerProfileOpenApi(registry);
registerDeviceOpenApi(registry);
registerAccountTypeOpenApi(registry);
registerAccountOpenApi(registry);
registerCategoryOpenApi(registry);
registerTransactionOpenApi(registry);
registerTransferOpenApi(registry);
registerBudgetOpenApi(registry);
registerInvestmentOpenApi(registry);
registerGroupOpenApi(registry);
registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description:
    'Access JWT passed in the Authorization header as `Bearer <token>`. The exact token digest must be registered in Redis.',
});
const ErrorResponse = registry.register('ErrorResponse', ErrorResponseSchema);
const AuthUser = registry.register('AuthUser', AuthUserDtoSchema);
const AuthResponse = registry.register(
  'AuthResponse',
  createSuccessResponseSchema(AuthPayloadDtoSchema),
);
const CurrentAuthUserResponse = registry.register(
  'CurrentAuthUserResponse',
  createSuccessResponseSchema(AuthUser),
);
const NullResponse = registry.register('NullResponse', createSuccessResponseSchema(z.null()));
const protectedResponses = {
  401: {
    description: 'The access token or Redis session is invalid, revoked, or expired.',
    content: { 'application/json': { schema: ErrorResponse } },
  },
  403: {
    description: 'The authenticated user lacks the required permission.',
    content: { 'application/json': { schema: ErrorResponse } },
  },
};
const FileMetadata = registry.register('FileMetadata', FileDtoSchema);
const FileResponse = registry.register('FileResponse', createSuccessResponseSchema(FileMetadata));
const FileListResponse = registry.register(
  'FileListResponse',
  createSuccessResponseSchema(z.array(FileMetadata)),
);
const User = registry.register('User', UserDtoSchema);
const UserResponse = registry.register('UserResponse', createSuccessResponseSchema(User));
const UserListResponse = registry.register(
  'UserListResponse',
  createSuccessResponseSchema(z.array(User)),
);
const HealthResponse = registry.register(
  'HealthResponse',
  createSuccessResponseSchema(
    z.object({
      status: z.string(),
      database: z.string().optional(),
      redis: z.string().optional(),
    }),
  ),
);

registry.registerPath({
  method: 'get',
  path: '/health/live',
  tags: ['Health'],
  summary: 'Check process liveness',
  description: 'Reports whether the HTTP process is alive without checking dependencies.',
  operationId: 'getLiveness',
  responses: {
    200: {
      description: 'Process is alive.',
      content: { 'application/json': { schema: HealthResponse } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/health/ready',
  tags: ['Health'],
  summary: 'Check service readiness',
  description: 'Checks PostgreSQL and Redis connectivity.',
  operationId: 'getReadiness',
  responses: {
    200: {
      description: 'Dependencies are ready.',
      content: { 'application/json': { schema: HealthResponse } },
    },
    503: {
      description: 'A dependency is unavailable.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/register',
  tags: ['Authentication'],
  summary: 'Register a new user',
  description:
    'Creates a new user account with active status and returns initial access and refresh tokens.',
  operationId: 'register',
  request: {
    body: { required: true, content: { 'application/json': { schema: RegisterSchema } } },
  },
  responses: {
    201: {
      description: 'User registered and authenticated; access and refresh JWTs returned.',
      content: { 'application/json': { schema: AuthResponse } },
    },
    400: {
      description: 'Invalid request body.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    409: {
      description: 'Email or username already exists.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    422: {
      description: 'Validation failed.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    429: {
      description: 'Authentication rate limit exceeded.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/login',
  tags: ['Authentication'],
  summary: 'Log in with username/email and password',
  description:
    'Accepts a username or email identifier, creates an independently revocable Redis session, and returns access and refresh JWTs in the JSON body.',
  operationId: 'login',
  request: {
    body: { required: true, content: { 'application/json': { schema: LoginSchema } } },
  },
  responses: {
    200: {
      description: 'Authenticated; access and refresh JWTs returned.',
      content: { 'application/json': { schema: AuthResponse } },
    },
    401: {
      description: 'Generic invalid credentials response.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    422: {
      description: 'Invalid request body.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    429: {
      description: 'Authentication rate limit exceeded.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/refresh',
  tags: ['Authentication'],
  summary: 'Rotate the session JWTs',
  description:
    'Accepts the refresh JWT in JSON and atomically replaces both registered token digests in Redis. Replay revokes only that session.',
  operationId: 'refreshAuthentication',
  request: {
    body: { required: true, content: { 'application/json': { schema: RefreshTokenSchema } } },
  },
  responses: {
    200: {
      description: 'Both access and refresh JWTs rotated.',
      content: { 'application/json': { schema: AuthResponse } },
    },
    401: {
      description: 'Refresh token invalid, expired, or reused.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    422: {
      description: 'Invalid request body.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    429: {
      description: 'Refresh rate limit exceeded.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/logout',
  tags: ['Authentication'],
  summary: 'Log out the current session',
  description:
    'Revokes only the Redis session represented by the Bearer access token. Other sessions for the same user remain active.',
  operationId: 'logout',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Current session revoked.',
      content: { 'application/json': { schema: NullResponse } },
    },
    401: {
      description: 'Access token or session is invalid or expired.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/auth/me',
  tags: ['Authentication'],
  summary: 'Get the authenticated user',
  description:
    'Validates the Bearer access JWT, its exact Redis session registration, and the current active PostgreSQL user.',
  operationId: 'getAuthenticatedUser',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Authenticated user retrieved.',
      content: { 'application/json': { schema: CurrentAuthUserResponse } },
    },
    401: {
      description: 'Access token or session is invalid or expired.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/users',
  tags: ['Users'],
  summary: 'List users',
  description:
    'Requires the exact `user.index` permission. Returns active, non-deleted users with length-aware pagination.',
  operationId: 'listUsers',
  security: [{ bearerAuth: [] }],
  request: { query: ListUsersQuerySchema },
  responses: {
    200: {
      description: 'Users retrieved.',
      content: { 'application/json': { schema: UserListResponse } },
    },
    ...protectedResponses,
    422: {
      description: 'Invalid query.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    429: {
      description: 'Rate limited.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/users',
  tags: ['Users'],
  summary: 'Create a user',
  description:
    'Requires the exact `user.store` permission. Creates a user and hashes the password with Argon2id.',
  operationId: 'createUser',
  security: [{ bearerAuth: [] }],
  request: {
    body: { required: true, content: { 'application/json': { schema: CreateUserSchema } } },
  },
  responses: {
    201: {
      description: 'User created.',
      content: { 'application/json': { schema: UserResponse } },
    },
    ...protectedResponses,
    409: {
      description: 'Email conflict.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    422: {
      description: 'Validation failed.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/users/export',
  tags: ['Users'],
  summary: 'Export users to Excel',
  description:
    'Requires the exact `user.index` permission. Streams non-deleted users to an XLSX workbook without password fields.',
  operationId: 'exportUsers',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'XLSX workbook.',
      content: {
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
          schema: z.string().openapi({ format: 'binary' }),
        },
      },
    },
    ...protectedResponses,
    429: {
      description: 'Rate limited.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/users/import/template',
  tags: ['Users'],
  summary: 'Download the user import template',
  description:
    'Requires the exact `user.create` permission. Returns the canonical XLSX template with required headers and a status dropdown.',
  operationId: 'downloadUserImportTemplate',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'XLSX import template.',
      content: {
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
          schema: z.string().openapi({ format: 'binary' }),
        },
      },
    },
    ...protectedResponses,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/users/import',
  tags: ['Users'],
  summary: 'Import users from Excel',
  description:
    'Requires the exact `user.store` permission. Validates the XLSX signature, exact headers, row limit, every row, and email uniqueness before atomically creating users.',
  operationId: 'importUsers',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: {
        'multipart/form-data': {
          schema: z.object({ file: z.string().openapi({ format: 'binary' }) }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'All rows imported.',
      content: {
        'application/json': {
          schema: createSuccessResponseSchema(UserImportResultSchema),
        },
      },
    },
    ...protectedResponses,
    409: {
      description: 'One or more emails already exist.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    413: {
      description: 'XLSX exceeds the configured byte limit.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    422: {
      description: 'Invalid workbook, headers, or rows.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/users/{id}',
  tags: ['Users'],
  summary: 'Get a user',
  description: 'Requires the exact `user.index` permission. Returns one non-deleted user.',
  operationId: 'getUser',
  security: [{ bearerAuth: [] }],
  request: { params: UserIdParamsSchema },
  responses: {
    200: {
      description: 'User retrieved.',
      content: { 'application/json': { schema: UserResponse } },
    },
    ...protectedResponses,
    404: {
      description: 'User not found.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    422: {
      description: 'Invalid identifier.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/users/{id}',
  tags: ['Users'],
  summary: 'Update a user',
  description: 'Requires the exact `user.update` permission. Updates validated user fields.',
  operationId: 'updateUser',
  security: [{ bearerAuth: [] }],
  request: {
    params: UserIdParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateUserSchema } } },
  },
  responses: {
    200: {
      description: 'User updated.',
      content: { 'application/json': { schema: UserResponse } },
    },
    ...protectedResponses,
    404: {
      description: 'User not found.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    409: {
      description: 'Email conflict.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    422: {
      description: 'Validation failed.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/users/{id}',
  tags: ['Users'],
  summary: 'Delete a user',
  description: 'Requires the exact `user.destroy` permission. Soft-deletes a user.',
  operationId: 'deleteUser',
  security: [{ bearerAuth: [] }],
  request: { params: UserIdParamsSchema },
  responses: {
    200: {
      description: 'User deleted.',
      content: { 'application/json': { schema: createSuccessResponseSchema(z.null()) } },
    },
    ...protectedResponses,
    404: {
      description: 'User not found.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    422: {
      description: 'Invalid identifier.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/files',
  tags: ['Files'],
  summary: 'List files',
  description:
    'Requires the exact `file.index` permission. Lists active file metadata; binary contents are not included.',
  operationId: 'listFiles',
  security: [{ bearerAuth: [] }],
  request: { query: ListFilesQuerySchema },
  responses: {
    200: {
      description: 'File metadata retrieved.',
      content: { 'application/json': { schema: FileListResponse } },
    },
    ...protectedResponses,
    422: {
      description: 'Invalid query.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/files',
  tags: ['Files'],
  summary: 'Upload a file',
  description:
    'Requires the exact `file.store` permission. Validates size, MIME signature, extension, and allowlist before storing binary content and PostgreSQL metadata.',
  operationId: 'uploadFile',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: {
        'multipart/form-data': {
          schema: z.object({ file: z.string().openapi({ format: 'binary' }) }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'File uploaded.',
      content: { 'application/json': { schema: FileResponse } },
    },
    ...protectedResponses,
    413: {
      description: 'File exceeds the configured byte limit.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    422: {
      description: 'Missing, unsupported, or mismatched file.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/files/{id}',
  tags: ['Files'],
  summary: 'Get file metadata',
  description:
    'Requires the exact `file.show` permission. Returns metadata without reading the stored binary.',
  operationId: 'getFile',
  security: [{ bearerAuth: [] }],
  request: { params: FileIdParamsSchema },
  responses: {
    200: {
      description: 'File metadata retrieved.',
      content: { 'application/json': { schema: FileResponse } },
    },
    ...protectedResponses,
    404: {
      description: 'File not found.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    422: {
      description: 'Invalid identifier.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/files/{id}/download',
  tags: ['Files'],
  summary: 'Download a file',
  description:
    'Requires the exact `file.download` permission. Streams binary content using trusted metadata and safe attachment headers.',
  operationId: 'downloadFile',
  security: [{ bearerAuth: [] }],
  request: { params: FileIdParamsSchema },
  responses: {
    200: {
      description: 'Stored binary content.',
      content: { 'application/octet-stream': { schema: z.string().openapi({ format: 'binary' }) } },
    },
    ...protectedResponses,
    404: {
      description: 'File not found.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    422: {
      description: 'Invalid identifier.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/files/{id}',
  tags: ['Files'],
  summary: 'Delete a file',
  description:
    'Requires the exact `file.destroy` permission. Soft-deletes metadata and removes the underlying stored object.',
  operationId: 'deleteFile',
  security: [{ bearerAuth: [] }],
  request: { params: FileIdParamsSchema },
  responses: {
    200: {
      description: 'File deleted.',
      content: { 'application/json': { schema: createSuccessResponseSchema(z.null()) } },
    },
    ...protectedResponses,
    404: {
      description: 'File not found.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    422: {
      description: 'Invalid identifier.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

const generator = new OpenApiGeneratorV31(registry.definitions);

export const openApiDocument = generator.generateDocument({
  openapi: '3.1.0',
  info: {
    title: 'Express Starter Kit API',
    version: '1.0.0',
    description: 'Production-ready Express.js API starter kit.',
  },
  servers: [{ url: '/', description: 'Current server' }],
  tags: [
    { name: 'Health', description: 'Liveness and readiness endpoints' },
    {
      name: 'Authentication',
      description: 'Bearer JWT authentication with independently revocable Redis sessions',
    },
    { name: 'Users', description: 'User management and Excel import/export' },
    { name: 'Files', description: 'Validated file storage and metadata management' },
    { name: 'Categories', description: 'Owner-only income and expense categories; no RBAC' },
  ],
});
