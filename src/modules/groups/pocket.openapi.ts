import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { createSuccessResponseSchema, ErrorResponseSchema } from '../../common/contracts/api-response.schema.js';
import { z } from '../../common/openapi/zod.js';
import { CreatePocketSchema, PocketAccountInputSchema, PocketDtoSchema, PocketGroupParamsSchema, PocketParamsSchema } from './pocket.schema.js';

export function registerPocketOpenApi(registry: OpenAPIRegistry): void {
    const description = 'Active group membership required; no additional RBAC. Full balances only, no funds moved. Live owned leaf accounts only; one pocket per account per group. Assignment atomically creates group_accounts consent if absent. Unlink preserves that grant. Reads require current consent and active owner membership, omit invalid/non-leaf accounts, expose owner name and Parent - Child display name but never account number. Decimal strings, totals grouped by currency. No-store. POST assignment is idempotent; another pocket gives 409. DELETE is idempotent and accepts tombstoned/non-leaf owned accounts for cleanup.';
    const id = '019a0000-0000-7000-8000-000000000001';
    const pocket = { id, name: 'Holiday', description: null, balances: [], accounts: [] };
    const routes = [
        { method: 'get' as const, path: '/api/v1/groups/{groupId}/pockets', operationId: 'listGroupPockets', summary: 'Read purpose-based group pockets', params: PocketGroupParamsSchema, schema: z.array(PocketDtoSchema), example: [pocket] },
        { method: 'post' as const, path: '/api/v1/groups/{groupId}/pockets', operationId: 'createGroupPocket', summary: 'Create a named group pocket', params: PocketGroupParamsSchema, body: CreatePocketSchema, schema: PocketDtoSchema, example: pocket },
        { method: 'post' as const, path: '/api/v1/groups/{groupId}/pockets/{pocketId}/accounts', operationId: 'assignGroupPocketAccount', summary: 'Assign an owned leaf account', params: PocketParamsSchema, body: PocketAccountInputSchema, schema: z.null(), example: null },
        { method: 'delete' as const, path: '/api/v1/groups/{groupId}/pockets/{pocketId}/accounts', operationId: 'unassignGroupPocketAccount', summary: 'Unlink an owned account without revoking sharing', params: PocketParamsSchema, body: PocketAccountInputSchema, schema: z.null(), example: null },
    ];
    for (const route of routes) {
        registry.registerPath({
            method: route.method, path: route.path, operationId: route.operationId, summary: route.summary, description,
            tags: ['Groups'], security: [{ bearerAuth: [] }],
            request: { params: route.params, ...('body' in route ? { body: { required: true, content: { 'application/json': { schema: route.body } } } } : {}) },
            responses: {
                [route.operationId === 'createGroupPocket' ? 201 : 200]: { description: 'Success.', content: { 'application/json': { schema: createSuccessResponseSchema(route.schema), example: { success: true, message: 'Data berhasil diambil.', timestamp: '2026-11-04 10:00:00', total_data: Array.isArray(route.example) ? route.example.length : route.example === null ? 0 : 1, data: route.example } } } },
                ...Object.fromEntries([400, 401, 403, 404, 409, 422, 429, 500].map((status) => [status, { description: 'Invalid request, inactive membership, foreign resource, allocation conflict, rate limit or dependency error.', content: { 'application/json': { schema: ErrorResponseSchema } } }])),
            },
        });
    }
}
