import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import {
  createSuccessResponseSchema,
  ErrorResponseSchema,
} from '../../common/contracts/api-response.schema.js';
import { z } from '../../common/openapi/zod.js';
import {
  ObligationHttpCommandSchema,
  ObligationIdParamsSchema,
  ObligationDtoSchema,
  ObligationEventDtoSchema,
  ObligationCommandResultSchema,
} from './obligation.schema.js';

export function registerObligationOpenApi(registry: OpenAPIRegistry): void {
  const errors = Object.fromEntries(
    [400, 401, 404, 409, 422, 500].map((status) => [
      status,
      {
        description: 'Invalid input, session, ownership, version or server failure.',
        content: { 'application/json': { schema: ErrorResponseSchema } },
      },
    ]),
  );
  for (const endpoint of [
    {
      method: 'get' as const,
      path: '/api/v1/obligations',
      operationId: 'listObligations',
      summary: 'List my debts and receivables',
      schema: z.array(ObligationDtoSchema),
      request: {},
    },
    {
      method: 'get' as const,
      path: '/api/v1/obligations/{id}/events',
      operationId: 'listObligationEvents',
      summary: 'List my loan payment history',
      schema: z.array(ObligationEventDtoSchema),
      request: { params: ObligationIdParamsSchema },
    },
    {
      method: 'post' as const,
      path: '/api/v1/obligations/commands',
      operationId: 'recordObligationCommand',
      summary: 'Record a loan or payment',
      schema: ObligationCommandResultSchema,
      request: {
        body: {
          required: true,
          content: { 'application/json': { schema: ObligationHttpCommandSchema } },
        },
      },
    },
  ])
    registry.registerPath({
      method: endpoint.method,
      path: endpoint.path,
      operationId: endpoint.operationId,
      summary: endpoint.summary,
      request: endpoint.request,
      tags: ['Obligations'],
      security: [{ bearerAuth: [] }],
      description:
        'Owner-private IDR loans. PAYABLE means I owe; RECEIVABLE means someone owes me. Uses the same atomic ledger, sync publication, version checks and immutable command IDs as mobile sync. Replay the identical command ID and payload after a timeout. Principal is a transfer; interest and fees are categorized separately. Existing balances can be linked without moving cash or double counting. No RBAC grant or device registration required.',
      responses: {
        ...errors,
        200: {
          description: 'Success',
          content: { 'application/json': { schema: createSuccessResponseSchema(endpoint.schema) } },
        },
      },
    });
}
