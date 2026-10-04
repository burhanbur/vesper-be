import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import {
  createSuccessResponseSchema,
  ErrorResponseSchema,
  PaginationSchema,
} from '../../common/contracts/api-response.schema.js';
import { z } from '../../common/openapi/zod.js';
import {
  CategoryDtoSchema,
  CategoryIdParamsSchema,
  CreateCategorySchema,
  DeleteCategoryQuerySchema,
  ListCategoriesQuerySchema,
  UpdateCategorySchema,
} from './category.schema.js';

const example = {
  id: '019a4fff-7000-7000-8000-000000000001',
  user_id: '019a4fff-7000-7000-8000-000000000002',
  name: 'Makanan',
  type: 'EXPENSE',
  version: '1',
  created_at: '2026-10-04T10:00:00.000Z',
  updated_at: '2026-10-04T10:00:00.000Z',
  deleted_at: null,
};

export function registerCategoryOpenApi(registry: OpenAPIRegistry): void {
  const dto = registry.register('Category', CategoryDtoSchema);
  const error = (description: string, message: string) => ({
    description,
    content: {
      'application/json': {
        schema: ErrorResponseSchema,
        example: {
          success: false,
          message,
          timestamp: '2026-10-04 10:00:00',
        },
      },
    },
  });
  const commonErrors = {
    400: error('Malformed JSON request.', 'Permintaan tidak valid.'),
    401: error(
      'Invalid JWT/Redis session or inactive/deleted user. No RBAC required.',
      'Autentikasi diperlukan.',
    ),
    422: error(
      'Invalid fields, unknown keys, missing version/type/name or empty PATCH.',
      'Permintaan tidak valid.',
    ),
    429: error('Shared API rate limit exceeded.', 'Terlalu banyak permintaan.'),
    500: error(
      'Unexpected dependency failure; transactional writes are rolled back.',
      'Terjadi kesalahan pada server.',
    ),
  };
  const conflict = {
    description:
      'Stale/exhausted version or type change on a category referenced by any historical transaction or budget (including deleted). Latest owned active safe DTO in errors.server_data; never foreign data.',
    content: {
      'application/json': {
        schema: ErrorResponseSchema.extend({ errors: z.strictObject({ server_data: dto }) }),
        example: {
          success: false,
          message: 'Versi kategori tidak sesuai atau telah mencapai batas maksimum.',
          timestamp: '2026-10-04 10:00:00',
          errors: { server_data: example },
        },
      },
    },
  };
  const success = (description: string, message: string, list = false) => ({
    description,
    content: {
      'application/json': {
        schema: list
          ? createSuccessResponseSchema(z.array(dto)).extend({ pagination: PaginationSchema })
          : createSuccessResponseSchema(dto),
        example: {
          success: true,
          message,
          timestamp: '2026-10-04 10:00:00',
          total_data: 1,
          data: list ? [example] : example,
          ...(list
            ? {
                pagination: {
                  total: 1,
                  per_page: 20,
                  current_page: 1,
                  last_page: 1,
                  from: 1,
                  to: 1,
                },
              }
            : {}),
        },
      },
    },
  });
  const security = [{ bearerAuth: [] }];
  const tags = ['Categories'];
  registry.registerPath({
    method: 'get',
    path: '/api/v1/categories',
    tags,
    security,
    summary: 'List owned categories',
    operationId: 'listCategories',
    description:
      'Without account_id, current-user non-deleted categories only. With account_id, validate owner OR active joined-group shared access and return the account-type owner categories; inaccessible account returns 404. No arbitrary user_id selector or RBAC permission. page=1 (max 1000000), limit=20 (max 100); sort created_at|-created_at|name|-name defaults to -created_at with stable ID tie-break. Optional case-insensitive name substring and exact INCOME/EXPENSE type filters. Shared-account lookup follows the account owner, never the actor.',
    request: { query: ListCategoriesQuerySchema },
    responses: {
      200: success('Paginated categories.', 'Kategori berhasil diambil.', true),
      ...commonErrors,
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/categories',
    tags,
    security,
    summary: 'Create an owned category',
    operationId: 'createCategory',
    description:
      'Required name and type (INCOME/EXPENSE), strict fields. Server UUIDv7 and version "1". No client IDs, no RBAC; retries are not idempotent. sync_changes is deferred to module 5.10.',
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: CreateCategorySchema,
            example: { name: 'Makanan', type: 'EXPENSE' },
          },
        },
      },
    },
    responses: { 201: success('Category created.', 'Kategori berhasil dibuat.'), ...commonErrors },
  });
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/categories/{id}',
    tags,
    security,
    summary: 'Update an owned category',
    operationId: 'updateCategory',
    description:
      'Required positive PostgreSQL bigint decimal-string version plus at least one name/type field. Row lock and version predicate atomically compare/increment. Missing/deleted/foreign IDs return 404. Type changes return 409 if any transaction, budget or group mapping references the category, including soft-deleted history. Owner advisory lock precedes the shared category row lock, coordinating with ledger writers. No RBAC.',
    request: {
      params: CategoryIdParamsSchema,
      body: {
        required: true,
        content: {
          'application/json': {
            schema: UpdateCategorySchema,
            example: { version: '1', name: 'Belanja makanan' },
          },
        },
      },
    },
    responses: {
      200: success('Category updated; version incremented.', 'Kategori berhasil diperbarui.'),
      404: error('Missing, deleted or foreign-owned category.', 'Kategori tidak ditemukan.'),
      409: conflict,
      ...commonErrors,
    },
  });
  registry.registerPath({
    method: 'delete',
    path: '/api/v1/categories/{id}',
    tags,
    security,
    summary: 'Soft-delete an owned category',
    operationId: 'deleteCategory',
    description:
      'Required query decimal-string version (?version=1), not body. Row lock and version predicate atomically increment version and set deleted_at. Never hard-deletes or cascades; preserves existing historical ledger references. Referenced categories may be soft-deleted; ledger reads preserve their UUIDs, while new/manual merged writes reject deleted categories under the shared owner/category lock protocol. Missing/deleted/foreign IDs return 404. No RBAC.',
    request: { params: CategoryIdParamsSchema, query: DeleteCategoryQuerySchema },
    responses: {
      200: {
        description: 'Category soft-deleted.',
        content: {
          'application/json': {
            schema: createSuccessResponseSchema(z.null()),
            example: {
              success: true,
              message: 'Kategori berhasil dihapus.',
              timestamp: '2026-10-04 10:00:00',
              total_data: 0,
              data: null,
            },
          },
        },
      },
      404: error('Missing, deleted or foreign-owned category.', 'Kategori tidak ditemukan.'),
      409: conflict,
      ...commonErrors,
    },
  });
}
