import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import {
  createSuccessResponseSchema,
  ErrorResponseSchema,
} from '../../common/contracts/api-response.schema.js';
import { z } from '../../common/openapi/zod.js';
import { ObligationDtoSchema, ObligationEventDtoSchema } from '../obligations/obligation.schema.js';
import { GoalDtoSchema, GoalAllocationDtoSchema } from '../goals/goal.schema.js';
import {
  RecoveryParamsSchema,
  RecoveryReceiptSchema,
  RecoveryRequestSchema,
  RecoveryReviewSchema,
} from './investment-recovery.schema.js';
import {
  PullQuerySchema,
  PullResponseSchema,
  PushBodySchema,
  PushItemSchema,
  PushResponseSchema,
} from './sync.schema.js';

export function registerSyncOpenApi(registry: OpenAPIRegistry): void {
  registry.register('Goal', GoalDtoSchema);
  registry.register('GoalAllocation', GoalAllocationDtoSchema);
  registry.register('Obligation', ObligationDtoSchema);
  registry.register('ObligationEvent', ObligationEventDtoSchema);
  for (const [method, path, operationId, summary, body] of [
    [
      'post',
      '/api/v1/sync/investment-recoveries',
      'requestInvestmentRecovery',
      'Request operator review of a never-applied investment command',
      RecoveryRequestSchema,
    ],
    [
      'get',
      '/api/v1/sync/investment-recoveries/{tradeId}',
      'readInvestmentRecovery',
      'Read an owner-scoped recovery receipt',
      null,
    ],
    [
      'post',
      '/api/v1/sync/investment-recoveries/{tradeId}/review',
      'reviewInvestmentRecovery',
      'Record a final operator decision',
      RecoveryReviewSchema,
    ],
  ] as const) {
    registry.registerPath({
      method,
      path,
      operationId,
      summary,
      tags: ['Sync'],
      security: [{ bearerAuth: [] }],
      description:
        'Never reverses an applied trade. Owner requests are bound to an owned device, exact canonical wire-command SHA-256 and owned active accounts. Review requires the current sync.investment-recoveries.review permission under database locks. CANCELLED reserves both UUIDs permanently and publishes account snapshots plus trade/cash tombstones atomically. Applied, partial, soft-deleted or colliding records refuse cancellation. Identical requests/decisions replay; altered content conflicts. Mobile must finish authoritative reconciliation before releasing its outbox. Requires the investment-recovery migration; no roles receive review permission automatically. Owner receipts omit command content, reason and reviewer identity.',
      request: {
        ...(path.includes('{tradeId}') ? { params: RecoveryParamsSchema } : {}),
        ...(body
          ? { body: { required: true, content: { 'application/json': { schema: body } } } }
          : {}),
      },
      responses: {
        200: {
          description: 'Status pemulihan.',
          content: {
            'application/json': { schema: createSuccessResponseSchema(RecoveryReceiptSchema) },
          },
        },
        ...Object.fromEntries(
          [401, 403, 404, 409, 422, 429, 500].map((status) => [
            status,
            {
              description: 'Permintaan gagal.',
              content: { 'application/json': { schema: ErrorResponseSchema } },
            },
          ]),
        ),
      },
    });
  }
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
      'Goals and goal_allocations recheck active household membership; private goals remain owner-only. Contributor allocation DTOs redact account_id for other viewers and carry current backed_amount plus backing_checked_at. Goal revocation emits tombstones. Owned device required. Decimal-string cursor, maximum 100 events. Optional compact=true returns only the latest change for each entity identity after since_version through the page watermark, ordered by that latest global commit version. Omitted/false preserves the original event stream. The feed carries current snapshots, not historical monetary deltas; compaction never deletes persisted events. Each page rechecks current authorization: inaccessible/deleted entities return DELETE with null payload, including identities whose historical CREATE was skipped. New writes between pages may emit the identity again. Persist next_version locally only after applying the page; device cursor records delivery, not acknowledgement. No retention. Initial since_version=0 includes migration bootstrap.',
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
      'Owned device required. Up to 100 sequential independently atomic items. WM06: obligation_commands CREATE accepts OPEN/REPAY/REVERSE/DELETE with client UUID, client_version=0, strict IDR cents and four stable ledger UUIDs. Obligations/events are private owner-only pull entities; cash rows follow existing household account access but expose only is_obligation_settlement, never private obligation IDs or counterparties. Principal uses protected signed TRANSFER rows, categorized interest/fees are separate. expected_version rejects concurrent edits. Matching commands replay without writes; altered payloads conflict. obligation_cancellations CREATE sends the exact original payload/ID: atomically reserves a never-applied command and ledger IDs and publishes authoritative state; already-applied commands return cancelled=false and must be reconciled, never undone. Partial pull or acknowledgement alone cannot release the client outbox. Requires the additive obligations migration. goals and goal_allocations use ordinary CREATE/UPDATE/DELETE envelopes and require the goals migration. Goal creators alone edit/archive/complete; household contributions require active membership and owned same-currency leaf CASH accounts. Currency/scope/start date are immutable. Allocations do not move cash, cannot exceed unreserved positive balance, and remain earmarked after completion until explicitly withdrawn. Zero amount withdraws; completion requires backed target. Server allocation backing uses cash once in created_at/UUID order and is republished after cash/eligibility changes. Former members can withdraw their own allocations but cannot read the household goal. Shared account access does not grant metadata writes. CREATE uses client UUID and client_version=0; versioned updates/deletes require positive version. Transfers support CREATE-only commands with client-assigned entity_id, from_transaction_id and to_transaction_id (three distinct UUIDs), client_version=0 and the regular transfer fields. A command atomically creates the transfer, two signed ledger rows and balance/sync changes. Identical persisted commands replay across owned devices without writes; changed payload/IDs or another actor return conflict without server_data. Current access to both accounts is required, including replay. Success server_data is the transfer DTO with both ledger IDs. Pull emits existing transactions/accounts, never a transfers entity; pages may split the committed pair. Direct transfer/investment-ledger mutations remain excluded. Investment CREATE commands use entity_type=investment_transactions, client_version=0, distinct client entity_id and payload.linked_transaction_id, required cash_account_id and BUY/SELL/DIVIDEND. Dividends settle net cash without changing holdings. Other fields follow the investment contract. Matching persisted commands replay across devices without writes after current account/instrument access checks; changed or inactive commands conflict without server_data. Trade, cash ledger, balances, snapshots and events commit atomically. Pull includes investment_transactions and settlement transactions; authorization is evaluated separately for each account and pages may split these rows. An account balance pull is not a command acknowledgement. Requires the additive investment-sync migration before deployment. Profiles use user_id as entity_id and serialized last-writer-wins. Invalid items return rejected; authorized conflicts include server_data. Infrastructure failures return 500; retry previously applied items safely.',
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
                {
                  entity_type: 'transfers',
                  entity_id: '019a0000-0000-7000-8000-000000000003',
                  operation: 'CREATE',
                  client_version: '0',
                  payload: {
                    from_account_id: '019a0000-0000-7000-8000-000000000004',
                    to_account_id: '019a0000-0000-7000-8000-000000000005',
                    from_transaction_id: '019a0000-0000-7000-8000-000000000006',
                    to_transaction_id: '019a0000-0000-7000-8000-000000000007',
                    amount: '25000.00',
                    transacted_at: '2026-10-15T10:00:00.000Z',
                    description: null,
                  },
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
