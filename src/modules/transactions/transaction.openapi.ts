import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import {
  createSuccessResponseSchema,
  ErrorResponseSchema,
  PaginationSchema,
} from '../../common/contracts/api-response.schema.js';
import { z } from '../../common/openapi/zod.js';
import { AccountDtoSchema } from '../accounts/account.schema.js';
import {
  CreateTransactionSchema,
  DeleteTransactionQuerySchema,
  ListTransactionsQuerySchema,
  TransactionDtoSchema,
  TransactionIdParamsSchema,
  UpdateTransactionSchema,
} from './transaction.schema.js';

const example = {
  id: '019a4fff-7000-7000-8000-000000000001',
  account_id: '019a4fff-7000-7000-8000-000000000002',
  category_id: '019a4fff-7000-7000-8000-000000000003',
  transfer_id: null,
  type: 'EXPENSE',
  amount: '15000.00',
  transacted_at: '2026-10-04T10:00:00.000Z',
  description: 'Makan siang',
  version: '1',
  created_by: '019a4fff-7000-7000-8000-000000000004',
  updated_by: '019a4fff-7000-7000-8000-000000000004',
  deleted_by: null,
  created_at: '2026-10-04T10:00:00.000Z',
  updated_at: '2026-10-04T10:00:00.000Z',
  deleted_at: null,
};
const bodyExample = {
  account_id: example.account_id,
  category_id: example.category_id,
  type: example.type,
  amount: example.amount,
  transacted_at: example.transacted_at,
  description: example.description,
};

export function registerTransactionOpenApi(registry: OpenAPIRegistry): void {
  const dto = registry.register('Transaction', TransactionDtoSchema);
  const error = (description: string, message: string) => ({
    description,
    content: {
      'application/json': {
        schema: ErrorResponseSchema,
        example: { success: false, message, timestamp: '2026-10-04 10:00:00' },
      },
    },
  });
  const commonErrors = {
    400: error('Malformed JSON.', 'Permintaan tidak valid.'),
    401: error(
      'Invalid JWT/Redis session or inactive/deleted user. No RBAC permissions required.',
      'Autentikasi diperlukan.',
    ),
    422: error(
      'Strict validation failure: unknown keys, numeric/nonpositive/oversized money, invalid dates/range, invalid version, empty PATCH or invalid merged fields. Manual category must be active, owned by account_types.user_id and match INCOME/EXPENSE; account and type must be active and owned. TRANSFER direct writes rejected until 5.6.',
      'Permintaan tidak valid.',
    ),
    429: error('Shared API rate limit exceeded.', 'Terlalu banyak permintaan.'),
    500: error(
      'Unexpected dependency failure; all ledger and balance writes roll back.',
      'Terjadi kesalahan pada server.',
    ),
  };
  const conflict = {
    description:
      'Stale/exhausted transaction version or linked-transfer mutation: errors.server_data is the latest owned active Transaction. Balance numeric(20,2) overflow or exhausted/stale account version: server_data is the affected Account. All writes roll back.',
    content: {
      'application/json': {
        schema: ErrorResponseSchema.extend({
          errors: z.strictObject({ server_data: z.union([dto, AccountDtoSchema]) }),
        }),
        examples: {
          version: {
            value: {
              success: false,
              message: 'Versi transaksi tidak sesuai atau telah mencapai batas maksimum.',
              timestamp: '2026-10-04 10:00:00',
              errors: { server_data: example },
            },
          },
          transfer: {
            value: {
              success: false,
              message: 'Transaksi transfer hanya dapat diubah melalui modul transfer.',
              timestamp: '2026-10-04 10:00:00',
              errors: {
                server_data: { ...example, transfer_id: '019a4fff-7000-7000-8000-000000000005' },
              },
            },
          },
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
  const tags = ['Transactions'];
  const writeDescription =
    'Owner OR active joined-group explicit account share via the common access policy. Shared members may create/edit/delete any manual transaction on accessible accounts. For moves both old/new accounts require access; category belongs to the target account-type owner, never actor. Sorted actual-owner advisory locks first, then grant SHARE locks coordinating revocation and sorted type/account/category/transaction row locks; CAS version predicates. Atomic live SUM(INCOME)-SUM(EXPENSE) using Decimal on affected accounts, not deltas or floating math; balance is server-only and account version increments only when balance changes. Signed balance magnitude <=999999999999999999.99. No sync publication/global cursor (5.10), transfers (5.6), investments (5.8) or balance history.';
  registry.registerPath({
    method: 'get',
    path: '/api/v1/transactions',
    tags,
    security,
    operationId: 'listTransactions',
    summary: 'List owned active transactions',
    description:
      'Only live transactions on active owned OR explicitly shared accounts/types. Historical category references remain visible even after category deletion. Optional exact account_id/category_id/type and inclusive date_range=start,end ISO timestamps (timezone and milliseconds required); no actor/user_id selector. page default 1/max 1000000, limit default 20/max 100, sort created_at|-created_at|transacted_at|-transacted_at default -transacted_at with stable ID tie-break. List/count share repeatable-read snapshot. DTO exposes this account_id and transfer_id only; no private counterpart account IDs or names are joined.',
    request: { query: ListTransactionsQuerySchema },
    responses: {
      200: success('Paginated transactions.', 'Transaksi berhasil diambil.', true),
      ...commonErrors,
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/transactions',
    tags,
    security,
    operationId: 'createTransaction',
    summary: 'Create manual income or expense',
    description: `Strict snake_case account_id/category_id/type/amount/transacted_at/description. Category UUID required for manual INCOME/EXPENSE. Positive decimal(20,2) STRING amount (max 18 integer digits, 2 fractional digits); version STRING, UUIDv7 and audit actors server-generated. Description omitted/null or trimmed nonempty <=5000 chars; dates ISO with timezone and milliseconds. Client transfer_id, balance, IDs, audit and version rejected; POST retries are not idempotent. ${writeDescription}`,
    request: {
      body: {
        required: true,
        content: { 'application/json': { schema: CreateTransactionSchema, example: bodyExample } },
      },
    },
    responses: {
      201: success('Transaction created; balance recomputed.', 'Transaksi berhasil dibuat.'),
      409: conflict,
      ...commonErrors,
    },
  });
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/transactions/{id}',
    tags,
    security,
    operationId: 'updateTransaction',
    summary: 'Update an owned manual transaction',
    description: `Required positive decimal-string version <=9223372036854775807 and at least one editable field. Validate merged account/category/type/amount/date/description, including omitted fields. Moving accounts recomputes both old/new balances. Linked transfer rows and TRANSFER type cannot be manually edited. Missing/deleted/foreign IDs return 404; stale/exhausted version 409 with latest safe owned DTO. ${writeDescription}`,
    request: {
      params: TransactionIdParamsSchema,
      body: {
        required: true,
        content: {
          'application/json': {
            schema: UpdateTransactionSchema,
            example: { version: '1', amount: '20000.00', description: 'Makan malam' },
          },
        },
      },
    },
    responses: {
      200: success(
        'Transaction updated; affected balances recomputed.',
        'Transaksi berhasil diperbarui.',
      ),
      404: error(
        'Missing/deleted/foreign transaction, or inaccessible account/type.',
        'Transaksi tidak ditemukan.',
      ),
      409: conflict,
      ...commonErrors,
    },
  });
  registry.registerPath({
    method: 'delete',
    path: '/api/v1/transactions/{id}',
    tags,
    security,
    operationId: 'deleteTransaction',
    summary: 'Soft-delete an owned manual transaction',
    description: `Required query ?version=1, positive bounded bigint STRING. Set deleted_at/deleted_by/updated_by and increment version; no hard delete/cascade. Existing deleted category does not block removal. Linked transfer rows cannot be manually deleted. ${writeDescription}`,
    request: { params: TransactionIdParamsSchema, query: DeleteTransactionQuerySchema },
    responses: {
      200: {
        description: 'Soft-deleted and balance recomputed.',
        content: {
          'application/json': {
            schema: createSuccessResponseSchema(z.null()),
            example: {
              success: true,
              message: 'Transaksi berhasil dihapus.',
              timestamp: '2026-10-04 10:00:00',
              total_data: 0,
              data: null,
            },
          },
        },
      },
      404: error(
        'Missing/deleted/foreign transaction, or inaccessible account/type.',
        'Transaksi tidak ditemukan.',
      ),
      409: conflict,
      ...commonErrors,
    },
  });
}
