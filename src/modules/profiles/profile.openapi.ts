import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import {
  createSuccessResponseSchema,
  ErrorResponseSchema,
} from '../../common/contracts/api-response.schema.js';
import { PatchProfileSchema, ProfileDtoSchema } from './profile.schema.js';

export function registerProfileOpenApi(registry: OpenAPIRegistry): void {
  const schema = registry.register(
    'ProfileResponse',
    createSuccessResponseSchema(ProfileDtoSchema),
  );
  const example = {
    success: true,
    message: 'Profil berhasil diambil.',
    timestamp: '2026-10-04 10:00:00',
    total_data: 1,
    data: {
      user_id: '019a0000-0000-7000-8000-000000000001',
      full_name: null,
      phone_number: null,
      gender: null,
      photo: null,
      base_currency: 'IDR',
      theme: 'system',
      created_at: null,
      updated_at: null,
      deleted_at: null,
    },
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
  const responses = {
    200: {
      description: 'Current user profile; timestamps are null until the first PATCH.',
      content: { 'application/json': { schema, example } },
    },
    401: error('JWT/Redis session invalid or user inactive/deleted. No RBAC permission required.'),
    429: error('API rate limit exceeded.'),
    500: error('Unexpected dependency failure.'),
  };
  registry.registerPath({
    method: 'get',
    path: '/api/v1/me',
    operationId: 'getMyProfile',
    tags: ['Profiles'],
    summary: 'Get my profile',
    security: [{ bearerAuth: [] }],
    description:
      'Owner-only profile. Missing profiles return defaults without a database write. Profile sync/change tracking is deferred to module 5.10.',
    responses,
  });
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/me',
    operationId: 'patchMyProfile',
    tags: ['Profiles'],
    summary: 'Update my profile',
    security: [{ bearerAuth: [] }],
    description:
      'Upserts only provided editable fields. Unknown keys and empty patches are rejected. Photo is a current-user-owned, non-deleted uploaded JPEG/PNG/WebP file UUID or null, not a URL. No RBAC required. No sync events are emitted yet.',
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: PatchProfileSchema,
            example: { full_name: 'Vesper User', base_currency: 'IDR', theme: 'system' },
          },
        },
      },
    },
    responses: {
      ...responses,
      400: error('Malformed JSON.'),
      409: error('Soft-deleted profile cannot be restored through PATCH.'),
      422: error('Invalid fields or unavailable/not-owned photo.'),
    },
  });
}
