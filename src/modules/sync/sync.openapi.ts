import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import {
  createSuccessResponseSchema,
  ErrorResponseSchema,
} from '../../common/contracts/api-response.schema.js';
import { z } from '../../common/openapi/zod.js';
import {
  PullQuerySchema,
  PullResponseSchema,
  PushBodySchema,
  PushItemSchema,
  PushResponseSchema,
} from './sync.schema.js';

export function registerSyncOpenApi(registry: OpenAPIRegistry): void {
  registry.register('SyncPushItem', PushItemSchema);
  const errors = Object.fromEntries(
    [401, 404, 422, 429, 500].map((status) => [
      status,
      {
        description: 'Permintaan gagal.',
        content: { 'application/json': { schema: ErrorResponseSchema } },
      },
    ]),
  );
  registry.registerPath({
    method: 'get',
    path: '/api/v1/sync/pull',
    operationId: 'pullSyncChanges',
    tags: ['Sync'],
    summary: 'Pull authorized changes in global commit order',
    description:
      'Owned device required. Decimal-string cursor, maximum 100 events. Latest authorized payloads; inaccessible/deleted entities return DELETE with null payload. Persist next_version locally only after applying the page; device cursor records delivery, not acknowledgement. No retention. Initial since_version=0 includes migration bootstrap.',
    security: [{ bearerAuth: [] }],
    request: { query: PullQuerySchema },
    responses: {
      200: {
        description: 'Perubahan berhasil diambil.',
        content: {
          'application/json': {
            schema: createSuccessResponseSchema(PullResponseSchema),
            example: {
              success: true,
              message: 'Perubahan berhasil diambil.',
              timestamp: '2026-10-04 10:00:00',
              total_data: 1,
              data: { changes: [], next_version: '0', watermark: '0', has_more: false },
            },
          },
        },
      },
      ...errors,
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/sync/push',
    operationId: 'pushSyncChanges',
    tags: ['Sync'],
    summary: 'Apply offline mutations independently',
    description:
      'Owned device required. Up to 100 sequential independently atomic items. Shared account access does not grant metadata writes. CREATE uses client UUID and client_version=0; versioned updates/deletes require positive version. Transfer and investment writes excluded. Profiles use user_id as entity_id and serialized last-writer-wins. Invalid items return rejected; authorized conflicts include server_data. Infrastructure failures return 500; retry previously applied items safely.',
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: PushBodySchema.extend({ items: z.array(PushItemSchema).min(1).max(100) }),
            example: {
              device_id: '019a0000-0000-7000-8000-000000000001',
              items: [
                {
                  entity_type: 'categories',
                  entity_id: '019a0000-0000-7000-8000-000000000002',
                  operation: 'CREATE',
                  client_version: '0',
                  payload: { name: 'Makanan', type: 'EXPENSE' },
                },
              ],
            },
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Hasil setiap perubahan.',
        content: {
          'application/json': { schema: createSuccessResponseSchema(PushResponseSchema) },
        },
      },
      ...errors,
    },
  });
}
