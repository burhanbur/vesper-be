import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import {
  createSuccessResponseSchema,
  ErrorResponseSchema,
  PaginationSchema,
} from '../../common/contracts/api-response.schema.js';
import { z } from '../../common/openapi/zod.js';
import {
  AccountTypeDtoSchema,
  AccountTypeIdParamsSchema,
  CreateAccountTypeSchema,
  DeleteAccountTypeQuerySchema,
  ListAccountTypesQuerySchema,
  UpdateAccountTypeSchema,
} from './account-type.schema.js';

const example = {
  id: '019a4fff-7000-7000-8000-000000000001',
  user_id: '019a4fff-7000-7000-8000-000000000002',
  name: 'Rekening Bank',
  category: 'CASH',
  version: '1',
  created_at: '2026-10-04T10:00:00.000Z',
  updated_at: '2026-10-04T10:00:00.000Z',
  deleted_at: null,
};

export function registerAccountTypeOpenApi(registry: OpenAPIRegistry): void {
  const dto = registry.register('AccountType', AccountTypeDtoSchema);
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
  const commonErrors = {
    400: error('Malformed JSON request.'),
    401: error('Invalid JWT/Redis session or inactive/deleted user; no RBAC required.'),
    422: error('Invalid input, unknown keys, missing version or empty PATCH.'),
    429: error('Shared API rate limit exceeded.'),
    500: error('Unexpected dependency failure; reference guard failures abort the mutation.'),
  };
  const conflict = {
    description:
      'Stale/exhausted version or category change with any account reference (including soft-deleted accounts). Latest owned non-deleted DTO is returned in errors.server_data.',
    content: {
      'application/json': {
        schema: ErrorResponseSchema.extend({ errors: z.strictObject({ server_data: dto }) }),
        example: {
          success: false,
          message: 'Versi tipe akun tidak sesuai atau telah mencapai batas maksimum.',
          timestamp: '2026-10-04 10:00:00',
          errors: { server_data: example },
        },
      },
    },
  };
  const success = (description: string, list = false) => ({
    description,
    content: {
      'application/json': {
        schema: list
          ? createSuccessResponseSchema(z.array(dto)).extend({ pagination: PaginationSchema })
          : createSuccessResponseSchema(dto),
        example: {
          success: true,
          message: 'Tipe akun berhasil diambil.',
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
  const tags = ['Account Types'];
  registry.registerPath({
    method: 'get',
    path: '/api/v1/account-types',
    tags,
    security,
    summary: 'List owned account types',
    operationId: 'listAccountTypes',
    description:
      'Only current-user non-deleted records. page defaults to 1, limit to 20 (max 100); sort created_at|-created_at|name|-name defaults to -created_at with a stable ID tie-break. Optional case-insensitive name substring and exact category filters. No RBAC permission required.',
    request: { query: ListAccountTypesQuerySchema },
    responses: { 200: success('Paginated account types.', true), ...commonErrors },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/account-types',
    tags,
    security,
    summary: 'Create an account type',
    operationId: 'createAccountType',
    description:
      'Creates an owned UUIDv7 record at version "1". category defaults to CASH. Client IDs are not accepted; POST retries are not idempotent. No sync_changes until module 5.10. No RBAC permission required.',
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: CreateAccountTypeSchema,
            example: { name: 'Rekening Bank', category: 'CASH' },
          },
        },
      },
    },
    responses: { 201: success('Account type created.'), ...commonErrors },
  });
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/account-types/{id}',
    tags,
    security,
    summary: 'Update an owned account type',
    operationId: 'updateAccountType',
    description:
      'Requires decimal-string version and at least one editable field (name/category). Atomically compares and increments version. An unchanged category permits edits even when referenced; changing category is prohibited once any account references the type. Missing, deleted and foreign-owned IDs all return 404. No RBAC permission required.',
    request: {
      params: AccountTypeIdParamsSchema,
      body: {
        required: true,
        content: {
          'application/json': {
            schema: UpdateAccountTypeSchema,
            example: { version: '1', name: 'Tabungan' },
          },
        },
      },
    },
    responses: {
      200: success('Account type updated; version incremented.'),
      404: error('Account type not found.'),
      409: conflict,
      ...commonErrors,
    },
  });
  registry.registerPath({
    method: 'delete',
    path: '/api/v1/account-types/{id}',
    tags,
    security,
    summary: 'Soft-delete an owned account type',
    operationId: 'deleteAccountType',
    description:
      'Requires version as a query decimal string, e.g. ?version=1 (not a body field). Atomically compares/increments version and sets deleted_at. Does not cascade into accounts. Missing, deleted and foreign-owned IDs return 404; stale version returns latest owned DTO. No RBAC permission required.',
    request: { params: AccountTypeIdParamsSchema, query: DeleteAccountTypeQuerySchema },
    responses: {
      200: {
        description: 'Account type soft-deleted.',
        content: {
          'application/json': {
            schema: createSuccessResponseSchema(z.null()),
            example: {
              success: true,
              message: 'Tipe akun berhasil dihapus.',
              timestamp: '2026-10-04 10:00:00',
              total_data: 0,
              data: null,
            },
          },
        },
      },
      404: error('Account type not found.'),
      409: conflict,
      ...commonErrors,
    },
  });
}
