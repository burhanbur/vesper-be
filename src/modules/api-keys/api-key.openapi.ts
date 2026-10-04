import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import {
  createSuccessResponseSchema,
  ErrorResponseSchema,
  PaginationSchema,
} from '../../common/contracts/api-response.schema.js';
import { z } from '../../common/openapi/zod.js';
import {
  ApiKeyCreatedDtoSchema,
  ApiKeyDtoSchema,
  ApiKeyIdParamsSchema,
  ApiKeyM2mTestDtoSchema,
  CreateApiKeySchema,
  ListApiKeysQuerySchema,
  UpdateApiKeySchema,
} from './api-key.schema.js';

export function registerApiKeyOpenApi(registry: OpenAPIRegistry): void {
  registry.registerComponent('securitySchemes', 'apiKeyAuth', {
    type: 'apiKey',
    in: 'header',
    name: 'X-API-Key',
    description: 'Machine-to-machine API Key authentication header.',
  });

  const apiKeyDto = registry.register('ApiKey', ApiKeyDtoSchema);
  const apiKeyCreatedDto = registry.register('ApiKeyCreated', ApiKeyCreatedDtoSchema);
  const apiKeyM2mTestDto = registry.register('ApiKeyM2mTest', ApiKeyM2mTestDtoSchema);

  const listResponse = registry.register(
    'ApiKeyListResponse',
    createSuccessResponseSchema(z.array(apiKeyDto)).extend({ pagination: PaginationSchema }),
  );
  const singleResponse = registry.register(
    'ApiKeyResponse',
    createSuccessResponseSchema(apiKeyDto),
  );
  const createdResponse = registry.register(
    'ApiKeyCreatedResponse',
    createSuccessResponseSchema(apiKeyCreatedDto),
  );
  const verifyResponse = registry.register(
    'ApiKeyVerifyResponse',
    createSuccessResponseSchema(apiKeyM2mTestDto),
  );
  const deleteResponse = registry.register(
    'ApiKeyDeleteResponse',
    createSuccessResponseSchema(z.null()),
  );

  const errorContent = (message: string) => ({
    'application/json': {
      schema: ErrorResponseSchema,
      example: { success: false, message, timestamp: '2026-10-04 10:00:00' },
    },
  });

  const errors = {
    400: {
      description: 'Malformed request or JSON.',
      content: errorContent('Permintaan tidak valid.'),
    },
    401: {
      description: 'Missing, invalid or expired credentials.',
      content: errorContent('Autentikasi diperlukan.'),
    },
    422: {
      description: 'Validation failed.',
      content: errorContent('Validasi gagal. Silakan periksa kembali input Anda.'),
    },
    500: {
      description: 'Unexpected server error.',
      content: errorContent('Terjadi kesalahan pada server.'),
    },
  };

  const exampleKey = {
    id: '019c0000-0000-7000-8000-000000000001',
    name: 'Billing Integration',
    description: 'Integration key for external payment service',
    application: 'billing-service',
    ip_whitelist: ['192.168.1.1', '10.0.0.0/24'],
    permissions: ['transactions:read', 'accounts:read'],
    is_active: true,
    rate_limit: 120,
    last_used_at: '2026-10-04T10:00:00.000Z',
    expires_at: '2027-10-04T10:00:00.000Z',
    created_at: '2026-10-04T09:00:00.000Z',
    updated_at: '2026-10-04T09:00:00.000Z',
  };

  // M2M verification
  registry.registerPath({
    method: 'get',
    path: '/api/v1/api-keys/verify',
    tags: ['API Keys'],
    summary: 'Verify machine-to-machine API Key credentials',
    description:
      'Validates caller machine-to-machine authentication using the X-API-Key header. Checks active status, expiration, and IP whitelist constraints.',
    operationId: 'verifyApiKeyM2m',
    security: [{ apiKeyAuth: [] }],
    responses: {
      200: {
        description: 'API Key credentials are valid and active.',
        content: {
          'application/json': {
            schema: verifyResponse,
            example: {
              success: true,
              message: 'Autentikasi API Key machine-to-machine berhasil.',
              timestamp: '2026-10-04 10:00:00',
              total_data: 1,
              data: {
                id: '019c0000-0000-7000-8000-000000000001',
                name: 'Billing Integration',
                application: 'billing-service',
                permissions: ['transactions:read'],
                authenticated: true,
              },
            },
          },
        },
      },
      ...errors,
      403: {
        description: 'API Key is revoked, expired, or IP address not whitelisted.',
        content: errorContent('API Key tidak aktif atau telah dicabut.'),
      },
    },
  });

  // List API keys
  registry.registerPath({
    method: 'get',
    path: '/api/v1/api-keys',
    tags: ['API Keys'],
    summary: 'List API Keys',
    description: 'Retrieve paginated list of API keys. Requires user authentication.',
    operationId: 'listApiKeys',
    security: [{ bearerAuth: [] }],
    request: { query: ListApiKeysQuerySchema },
    responses: {
      200: {
        description: 'List of API keys.',
        content: {
          'application/json': {
            schema: listResponse,
            example: {
              success: true,
              message: 'Daftar API Key berhasil diambil.',
              timestamp: '2026-10-04 10:00:00',
              total_data: 1,
              data: [exampleKey],
              pagination: {
                total: 1,
                per_page: 20,
                current_page: 1,
                last_page: 1,
                from: 1,
                to: 1,
              },
            },
          },
        },
      },
      ...errors,
    },
  });

  // Create API key
  registry.registerPath({
    method: 'post',
    path: '/api/v1/api-keys',
    tags: ['API Keys'],
    summary: 'Create API Key',
    description:
      'Creates a new API Key for machine-to-machine authentication. The plaintext 64-character key is returned only once upon creation.',
    operationId: 'createApiKey',
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: CreateApiKeySchema,
            example: {
              name: 'Billing Integration',
              description: 'Key for automated monthly sync',
              application: 'billing-service',
              ip_whitelist: ['192.168.1.1'],
              permissions: ['transactions:read'],
              rate_limit: 120,
            },
          },
        },
      },
    },
    responses: {
      201: {
        description: 'API Key created successfully. Store key value securely.',
        content: {
          'application/json': {
            schema: createdResponse,
            example: {
              success: true,
              message:
                'API Key berhasil dibuat. Simpan kunci ini karena tidak akan ditampilkan lagi.',
              timestamp: '2026-10-04 10:00:00',
              total_data: 1,
              data: {
                ...exampleKey,
                key: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
              },
            },
          },
        },
      },
      ...errors,
    },
  });

  // Get by ID
  registry.registerPath({
    method: 'get',
    path: '/api/v1/api-keys/{id}',
    tags: ['API Keys'],
    summary: 'Get API Key details',
    description: 'Retrieve details of an API key by ID without exposing the raw secret key.',
    operationId: 'getApiKeyById',
    security: [{ bearerAuth: [] }],
    request: { params: ApiKeyIdParamsSchema },
    responses: {
      200: {
        description: 'API Key details.',
        content: {
          'application/json': {
            schema: singleResponse,
            example: {
              success: true,
              message: 'Detail API Key berhasil diambil.',
              timestamp: '2026-10-04 10:00:00',
              total_data: 1,
              data: exampleKey,
            },
          },
        },
      },
      ...errors,
      404: {
        description: 'API Key not found.',
        content: errorContent('API Key tidak ditemukan.'),
      },
    },
  });

  // Update API key
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/api-keys/{id}',
    tags: ['API Keys'],
    summary: 'Update API Key',
    description:
      'Update metadata, whitelist, permissions, status, or expiration of an existing API Key.',
    operationId: 'updateApiKey',
    security: [{ bearerAuth: [] }],
    request: {
      params: ApiKeyIdParamsSchema,
      body: {
        required: true,
        content: {
          'application/json': {
            schema: UpdateApiKeySchema,
            example: {
              name: 'Updated Billing Key',
              is_active: false,
            },
          },
        },
      },
    },
    responses: {
      200: {
        description: 'API Key updated successfully.',
        content: {
          'application/json': {
            schema: singleResponse,
            example: {
              success: true,
              message: 'API Key berhasil diperbarui.',
              timestamp: '2026-10-04 10:00:00',
              total_data: 1,
              data: {
                ...exampleKey,
                name: 'Updated Billing Key',
                is_active: false,
              },
            },
          },
        },
      },
      ...errors,
      404: {
        description: 'API Key not found.',
        content: errorContent('API Key tidak ditemukan.'),
      },
    },
  });

  // Delete API key
  registry.registerPath({
    method: 'delete',
    path: '/api/v1/api-keys/{id}',
    tags: ['API Keys'],
    summary: 'Delete API Key',
    description: 'Permanently delete an API Key.',
    operationId: 'deleteApiKey',
    security: [{ bearerAuth: [] }],
    request: { params: ApiKeyIdParamsSchema },
    responses: {
      200: {
        description: 'API Key deleted.',
        content: {
          'application/json': {
            schema: deleteResponse,
            example: {
              success: true,
              message: 'API Key berhasil dihapus.',
              timestamp: '2026-10-04 10:00:00',
              total_data: 0,
              data: null,
            },
          },
        },
      },
      ...errors,
      404: {
        description: 'API Key not found.',
        content: errorContent('API Key tidak ditemukan.'),
      },
    },
  });
}
