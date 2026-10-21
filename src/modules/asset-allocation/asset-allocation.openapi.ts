import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import {
  createSuccessResponseSchema,
  ErrorResponseSchema,
} from '../../common/contracts/api-response.schema.js';
import { AllocationDtoSchema, AllocationQuerySchema } from './asset-allocation.schema.js';

export function registerAssetAllocationOpenApi(registry: OpenAPIRegistry): void {
  registry.register('AssetAllocation', AllocationDtoSchema);
  registry.registerPath({
    method: 'get',
    path: '/api/v1/net-worth/allocation',
    operationId: 'getAssetAllocation',
    tags: ['Net Worth'],
    summary: 'Read current owner-only gross asset allocation',
    description:
      'Active authenticated identity required, no additional RBAC grant. IDR only; no FX or historical date. Reuses WM02 active owned included leaf-account scope, excludes parent/foreign accounts and replaces WM06 mapped balances with obligations once. Positive CASH and INVESTMENT ledger balances form CASH; payable/negative-balance liabilities are disclosed separately and never netted from the denominator. Receivables form RECEIVABLE, supported holdings use instrument type. WM02 position values round to cents before cross-account instrument aggregation. A single RepeatableRead source supplies quantities, balances, class metadata and last quote at/before current UTC date. No financial mutation, historical capture or auto-trading. Missing/inconsistent valuation or class data makes the result partial; all percentages remain null rather than rescaling known values. Unknown amounts remain null and known subtotals remain explicit. Stale means quote before current UTC day; dated/source-labelled values remain provisional. Complete empty/zero gross assets also yield null percentages. Positive gross asset percentages truncate to two decimals and may sum below 100%. Targets are owner/device-local mobile settings, not API writes. Scope limits follow WM02 (1000 accounts/obligations and 10000 position groups). See docs/asset-allocation.md.',
    security: [{ bearerAuth: [] }],
    request: { query: AllocationQuerySchema },
    responses: {
      200: {
        description: 'Current complete or explicitly partial asset allocation',
        content: {
          'application/json': { schema: createSuccessResponseSchema(AllocationDtoSchema) },
        },
      },
      ...Object.fromEntries(
        [401, 422, 429, 500, 503].map((code) => [
          code,
          {
            description: 'Permintaan gagal.',
            content: { 'application/json': { schema: ErrorResponseSchema } },
          },
        ]),
      ),
    },
  });
}
