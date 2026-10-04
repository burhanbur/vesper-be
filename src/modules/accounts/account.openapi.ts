import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import {
  createSuccessResponseSchema,
  ErrorResponseSchema,
  PaginationSchema,
} from '../../common/contracts/api-response.schema.js';
import { z } from '../../common/openapi/zod.js';
import {
  AccountDtoSchema,
  AccountIdParamsSchema,
  CreateAccountSchema,
  DeleteAccountQuerySchema,
  ListAccountsQuerySchema,
  UpdateAccountSchema,
} from './account.schema.js';

const example = {
  id: '019a4fff-7000-7000-8000-000000000001',
  user_id: '019a4fff-7000-7000-8000-000000000002',
  account_type_id: '019a4fff-7000-7000-8000-000000000003',
  parent_account_id: null,
  name: 'Bank Jago',
  icon: null,
  currency: 'IDR',
  balance: '0.00',
  description: null,
  is_visible: true,
  is_include_total: true,
  sequence_order: '0',
  version: '1',
  created_at: '2026-10-04T10:00:00.000Z',
  updated_at: '2026-10-04T10:00:00.000Z',
  deleted_at: null,
};
export function registerAccountOpenApi(registry: OpenAPIRegistry): void {
  const dto = registry.register('Account', AccountDtoSchema);
  const error = (description: string, message = 'Permintaan tidak valid.') => ({
    description,
    content: {
      'application/json': {
        schema: ErrorResponseSchema,
        example: { success: false, message, timestamp: '2026-10-04 10:00:00' },
      },
    },
  });
  const common = {
    400: error('Malformed JSON.'),
    401: error(
      'Invalid JWT/session or inactive/deleted user; no RBAC permission required.',
      'Autentikasi diperlukan.',
    ),
    422: error(
      'Strict input validation: IDR only, bounded decimal-string version/order, balance forbidden. Type and parent must be active, owned and compatible.',
    ),
    429: error('Shared API rate limit.'),
    500: error('Unexpected dependency failure; mutations roll back.'),
  };
  const conflict = {
    description:
      'Stale/exhausted version, hierarchy cycle, active children preventing type change/deletion/total inclusion, or nonzero balance. errors.server_data is an owned safe DTO when available; a parent-version conflict may return that owned parent.',
    content: {
      'application/json': {
        schema: ErrorResponseSchema.extend({
          errors: z.strictObject({ server_data: dto }).optional(),
        }),
        example: {
          success: false,
          message: 'Versi akun tidak sesuai atau telah mencapai batas maksimum.',
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
  const tags = ['Accounts'];
  const security = [{ bearerAuth: [] }];
  const scope =
    'Active authenticated users, no RBAC. Lists allow owned OR explicitly shared accounts in an active joined group (distinct rows). Metadata create/PATCH/DELETE remains owner-only. No sync publication or balance history. ';
  registry.registerPath({
    method: 'get',
    path: '/api/v1/accounts',
    tags,
    security,
    operationId: 'listAccounts',
    summary: 'List accessible accounts',
    description:
      scope +
      'Non-deleted accounts, page=1, limit=20 (max 100), sort=sequence_order by default; created_at/name/sequence_order with optional minus prefix and stable ID tie-break. Filter account_type_id, parent_account_id (UUID for direct children, literal null for roots, omitted for all), is_visible (true/false). Balance is an authoritative decimal string, not a parent aggregate.',
    request: { query: ListAccountsQuerySchema },
    responses: {
      200: success(
        'Paginated owned or explicitly shared accounts.',
        'Akun berhasil diambil.',
        true,
      ),
      ...common,
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/accounts',
    tags,
    security,
    operationId: 'createAccount',
    summary: 'Create an owned account',
    description:
      scope +
      'Server UUIDv7, version 1, balance 0.00; client balance/ID/version forbidden. Defaults: IDR, null parent/icon/description, visible/include_total true, sequence_order 0. Owned active type and same-type active parent required. Attaching a child sets the parent include_total false and increments its version if changed, atomically. POST retries are not idempotent.',
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: CreateAccountSchema,
            example: {
              account_type_id: example.account_type_id,
              name: 'Bank Jago',
              currency: 'IDR',
              sequence_order: '0',
            },
          },
        },
      },
    },
    responses: {
      201: success('Account created.', 'Akun berhasil dibuat.'),
      409: conflict,
      ...common,
    },
  });
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/accounts/{id}',
    tags,
    security,
    operationId: 'updateAccount',
    summary: 'Update an owned account',
    description:
      scope +
      'Required version plus at least one editable field. Balance never editable. Prevents self-parent/cycles. Type changes are disallowed with active children or any historical transaction reference, including deleted transactions. include_total=true is allowed only for leaves. Reparenting excludes the new parent with a transactional version increment; former parent remains false until explicitly edited as a leaf. Neither parent nor child balances are changed.',
    request: {
      params: AccountIdParamsSchema,
      body: {
        required: true,
        content: {
          'application/json': {
            schema: UpdateAccountSchema,
            example: { version: '1', name: 'Tabungan', parent_account_id: null },
          },
        },
      },
    },
    responses: {
      200: success('Account updated; version incremented.', 'Akun berhasil diperbarui.'),
      404: error('Missing/deleted/foreign-owned ID.', 'Akun tidak ditemukan.'),
      409: conflict,
      ...common,
    },
  });
  registry.registerPath({
    method: 'delete',
    path: '/api/v1/accounts/{id}',
    tags,
    security,
    operationId: 'deleteAccount',
    summary: 'Soft-delete an owned leaf account',
    description:
      scope +
      'Requires query version (not request body). Soft deletion increments version. Active children, nonzero balance or active transactions (even with zero net balance) prevent deletion. No cascading or automatic former-parent total restoration. Shared owner advisory lock and type/account row locks coordinate with atomic ledger writes.',
    request: { params: AccountIdParamsSchema, query: DeleteAccountQuerySchema },
    responses: {
      200: {
        description: 'Account soft-deleted.',
        content: {
          'application/json': {
            schema: createSuccessResponseSchema(z.null()),
            example: {
              success: true,
              message: 'Akun berhasil dihapus.',
              timestamp: '2026-10-04 10:00:00',
              total_data: 0,
              data: null,
            },
          },
        },
      },
      404: error('Missing/deleted/foreign-owned ID.', 'Akun tidak ditemukan.'),
      409: conflict,
      ...common,
    },
  });
}
