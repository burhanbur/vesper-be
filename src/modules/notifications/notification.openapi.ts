import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import {
  createSuccessResponseSchema,
  ErrorResponseSchema,
  PaginationSchema,
} from '../../common/contracts/api-response.schema.js';
import { z } from '../../common/openapi/zod.js';
import {
  ListNotificationsQuerySchema,
  MarkNotificationReadBodySchema,
  NotificationDtoSchema,
  NotificationIdParamsSchema,
} from './notification.schema.js';

export function registerNotificationOpenApi(registry: OpenAPIRegistry): void {
  const notification = registry.register('Notification', NotificationDtoSchema);
  const listResponse = registry.register(
    'NotificationListResponse',
    createSuccessResponseSchema(z.array(notification)).extend({ pagination: PaginationSchema }),
  );
  const readResponse = registry.register(
    'NotificationReadResponse',
    createSuccessResponseSchema(notification),
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
      description:
        'Missing, invalid or expired authentication, revoked session, or inactive/deleted user.',
      content: errorContent('Autentikasi diperlukan.'),
    },
    422: {
      description: 'Invalid query, UUID, or body; unknown fields are rejected.',
      content: errorContent('Validasi gagal. Silakan periksa kembali input Anda.'),
    },
    429: {
      description: 'API rate limit exceeded.',
      content: errorContent('Terlalu banyak permintaan. Silakan coba lagi nanti.'),
    },
    500: {
      description: 'Unexpected dependency or server failure.',
      content: errorContent('Terjadi kesalahan pada server.'),
    },
  };
  const example = {
    id: '019c0000-0000-7000-8000-000000000001',
    user_id: '019c0000-0000-7000-8000-000000000002',
    type: 'info',
    title: 'Informasi akun',
    body: 'Informasi baru tersedia untuk akun Anda.',
    metadata: { resource_type: 'account' },
    is_read: true,
    read_at: '2026-10-04T10:00:00.000Z',
    created_at: '2026-10-04T09:00:00.000Z',
    updated_at: '2026-10-04T10:00:00.000Z',
  };
  registry.registerPath({
    method: 'get',
    path: '/api/v1/notifications',
    tags: ['Notifications'],
    summary: 'List own notifications',
    description:
      'Active authenticated users only; ownership is derived from the bearer identity, not a client user selector. No additional RBAC permission. Stable created_at/id ordering, page/limit pagination (limit at most 100), optional explicit is_read=true/false and info/error/warning type. Empty until a trusted server producer is implemented; no public creation endpoint.',
    operationId: 'listNotifications',
    security: [{ bearerAuth: [] }],
    request: { query: ListNotificationsQuerySchema },
    responses: {
      200: {
        description:
          'Own notifications with required pagination. total_data counts this page only.',
        content: {
          'application/json': {
            schema: listResponse,
            example: {
              success: true,
              message: 'Notifikasi berhasil diambil.',
              timestamp: '2026-10-04 10:00:00',
              total_data: 0,
              data: [],
              pagination: {
                total: 0,
                per_page: 20,
                current_page: 1,
                last_page: 1,
                from: null,
                to: null,
              },
            },
          },
        },
      },
      ...errors,
    },
  });
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/notifications/{id}/read',
    tags: ['Notifications'],
    summary: 'Mark own notification as read',
    description:
      'Active authenticated owner only; no additional RBAC permission. Accepts no body or an empty object, never arbitrary updates. The atomic first transition sets is_read=true and read_at; retries preserve both read_at and updated_at. Foreign and missing IDs share the same generic 404.',
    operationId: 'markNotificationRead',
    security: [{ bearerAuth: [] }],
    request: {
      params: NotificationIdParamsSchema,
      body: {
        required: false,
        content: { 'application/json': { schema: MarkNotificationReadBodySchema, example: {} } },
      },
    },
    responses: {
      200: {
        description: 'Notification is read, including idempotent retries.',
        content: {
          'application/json': {
            schema: readResponse,
            example: {
              success: true,
              message: 'Notifikasi berhasil ditandai sebagai dibaca.',
              timestamp: '2026-10-04 10:00:00',
              total_data: 1,
              data: example,
            },
          },
        },
      },
      ...errors,
      404: {
        description: 'Notification missing or not owned by the authenticated user.',
        content: {
          'application/json': {
            schema: ErrorResponseSchema,
            example: {
              success: false,
              message: 'Notifikasi tidak ditemukan.',
              timestamp: '2026-10-04 10:00:00',
            },
          },
        },
      },
    },
  });
}
