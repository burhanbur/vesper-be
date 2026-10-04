import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import {
  createSuccessResponseSchema,
  ErrorResponseSchema,
} from '../../common/contracts/api-response.schema.js';
import { CreateTransferSchema, TransferDtoSchema } from './transfer.schema.js';

const inputExample = {
  from_account_id: '019a4fff-7000-7000-8000-000000000001',
  to_account_id: '019a4fff-7000-7000-8000-000000000002',
  amount: '15000.00',
  transacted_at: '2026-10-04T10:00:00.000Z',
  description: 'Transfer tabungan',
};
export function registerTransferOpenApi(registry: OpenAPIRegistry): void {
  const dto = registry.register('Transfer', TransferDtoSchema);
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
  registry.registerPath({
    method: 'post',
    path: '/api/v1/transfers',
    tags: ['Transfers'],
    security: [{ bearerAuth: [] }],
    operationId: 'createTransfer',
    summary: 'Create an owned IDR transfer',
    description:
      'JWT and active Redis session required; no RBAC permission. Strict snake_case body; both distinct active accounts require owner OR active joined-group explicit shared access. Both currencies must be IDR; no currency conversion. Positive decimal(20,2) STRING amount, maximum 18 integer and 2 fractional digits; numeric amounts rejected. Timestamp requires timezone and milliseconds. Optional description is null or trimmed nonempty text up to 5000 characters. IDs, audit actors and version are server-generated. One database transaction creates a Transfer and exactly two linked TRANSFER transactions with null categories: negative amount from the source and positive amount to the destination. The response includes both linked transaction identifiers. Sorted actual account-owner advisory locks, grant SHARE locks, then sorted account-type/account locks serialize ledger writers and revocation. Recompute both live balances using exact Decimal income minus expenses plus incoming minus outgoing transfers; version increments only for changed balances. Any failure, malformed ledger, balance overflow or version conflict rolls back all writes. Manual transaction PATCH/DELETE cannot mutate linked legs. Shared access requires permission on both sides; response adds no counterpart names. No sync publication or balance history. POST retries are not idempotent.',
    request: {
      body: {
        required: true,
        content: { 'application/json': { schema: CreateTransferSchema, example: inputExample } },
      },
    },
    responses: {
      201: {
        description: 'Transfer and both legs created atomically; balances recomputed.',
        content: {
          'application/json': {
            schema: createSuccessResponseSchema(dto),
            example: {
              success: true,
              message: 'Transfer berhasil dibuat.',
              timestamp: '2026-10-04 10:00:00',
              total_data: 1,
              data: {
                ...inputExample,
                id: '019a4fff-7000-7000-8000-000000000003',
                version: '1',
                from_transaction_id: '019a4fff-7000-7000-8000-000000000005',
                to_transaction_id: '019a4fff-7000-7000-8000-000000000006',
                created_by: '019a4fff-7000-7000-8000-000000000004',
                updated_by: '019a4fff-7000-7000-8000-000000000004',
                deleted_by: null,
                created_at: inputExample.transacted_at,
                updated_at: inputExample.transacted_at,
                deleted_at: null,
              },
            },
          },
        },
      },
      400: error('Malformed JSON.', 'Permintaan tidak valid.'),
      401: error('Invalid JWT/session or inactive user.', 'Autentikasi diperlukan.'),
      409: error(
        'Malformed linked ledger, balance overflow or exhausted/stale account version; account conflicts include errors.server_data.',
        'Saldo atau versi akun melebihi batas maksimum.',
      ),
      422: error(
        'Strict validation failure, identical accounts, inactive/foreign accounts or types, or currency mismatch.',
        'Permintaan tidak valid.',
      ),
      429: error('Shared API rate limit exceeded.', 'Terlalu banyak permintaan.'),
      500: error(
        'Unexpected dependency failure; all writes roll back.',
        'Terjadi kesalahan pada server.',
      ),
    },
  });
}
