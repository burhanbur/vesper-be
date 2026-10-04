import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import {
  createSuccessResponseSchema,
  ErrorResponseSchema,
} from '../../common/contracts/api-response.schema.js';
import { z } from '../../common/openapi/zod.js';
import { DeviceDtoSchema, ListDevicesQuerySchema, RegisterDeviceSchema } from './device.schema.js';

export function registerDeviceOpenApi(registry: OpenAPIRegistry): void {
  const deviceSchema = registry.register(
    'DeviceResponse',
    createSuccessResponseSchema(DeviceDtoSchema),
  );
  const listSchema = registry.register(
    'DeviceListResponse',
    createSuccessResponseSchema(z.array(DeviceDtoSchema)),
  );
  const device = {
    id: '019a0000-0000-7000-8000-000000000002',
    user_id: '019a0000-0000-7000-8000-000000000001',
    name: 'Personal phone',
    platform: 'Android',
    app_version: '1.0.0',
    last_sync_version: '0',
    last_sync_at: null,
    last_seen_at: '2026-10-04T10:00:00.000Z',
    created_at: '2026-10-04T10:00:00.000Z',
    updated_at: '2026-10-04T10:00:00.000Z',
  };
  const example = {
    success: true,
    message: 'Perangkat berhasil didaftarkan.',
    timestamp: '2026-10-04 10:00:00',
    total_data: 1,
    data: device,
  };
  const error = (description: string) => ({
    description,
    content: {
      'application/json': {
        schema: ErrorResponseSchema,
        example: {
          success: false,
          message: 'Permintaan tidak valid.',
          timestamp: '2026-10-04 10:00:00',
        },
      },
    },
  });
  const errors = {
    401: error('JWT/Redis session invalid or user inactive/deleted. No RBAC permission required.'),
    422: error('Invalid input or unknown keys, including client sync cursor fields.'),
    429: error('API rate limit exceeded.'),
    500: error('Unexpected dependency failure.'),
  };
  registry.registerPath({
    method: 'get',
    path: '/api/v1/devices',
    operationId: 'listMyDevices',
    tags: ['Devices'],
    security: [{ bearerAuth: [] }],
    summary: 'List my devices',
    description:
      'Owner-only paginated listing with stable created_at/id ordering. Sync cursor is read-only and returned as a decimal string. No RBAC required.',
    request: { query: ListDevicesQuerySchema },
    responses: {
      ...errors,
      200: {
        description: 'Paginated current-user devices.',
        content: {
          'application/json': {
            schema: listSchema,
            example: {
              ...example,
              data: [device],
              pagination: { total: 1, per_page: 20, current_page: 1, last_page: 1, from: 1, to: 1 },
            },
          },
        },
      },
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/devices',
    operationId: 'registerMyDevice',
    tags: ['Devices'],
    security: [{ bearerAuth: [] }],
    summary: 'Register my device',
    description:
      "Optional client UUID makes retries idempotent. Existing owned devices refresh metadata and last_seen_at; another owner's UUID returns a generic conflict. Without id, each call creates a UUIDv7 device. Sync cursor fields cannot be supplied and are never changed here. Sync engine is not implemented yet. No RBAC required.",
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: RegisterDeviceSchema,
            example: {
              id: device.id,
              name: device.name,
              platform: device.platform,
              app_version: device.app_version,
            },
          },
        },
      },
    },
    responses: {
      ...errors,
      400: error('Malformed JSON.'),
      409: error('Device ID unavailable; no ownership details exposed.'),
      200: {
        description: 'Existing owned device registered again.',
        content: { 'application/json': { schema: deviceSchema, example } },
      },
      201: {
        description: 'New device registered.',
        content: { 'application/json': { schema: deviceSchema, example } },
      },
    },
  });
}
