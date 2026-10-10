import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import {
    createSuccessResponseSchema,
    ErrorResponseSchema,
    PaginationSchema,
} from '../../common/contracts/api-response.schema.js';
import { z } from '../../common/openapi/zod.js';
import {
    ListRefAccountTypesQuerySchema,
    ListRefCategoriesQuerySchema,
    RefAccountTypeDtoSchema,
    RefCategoryDtoSchema,
} from './reference.schema.js';

export function registerReferenceOpenApi(registry: OpenAPIRegistry): void {
    const accountType = registry.register('RefAccountType', RefAccountTypeDtoSchema);
    const category = registry.register('RefCategory', RefCategoryDtoSchema);
    const example = {
        id: '019a4fff-7000-7000-8000-000000000001',
        name: 'Bank',
        created_at: '2026-10-10T10:00:00.000Z',
        updated_at: '2026-10-10T10:00:00.000Z',
    };
    const error = (description: string) => ({
        description,
        content: {
            'application/json': {
                schema: ErrorResponseSchema,
                example: {
                    success: false,
                    message: 'Permintaan tidak valid.',
                    timestamp: '2026-10-10 10:00:00',
                },
            },
        },
    });
    for (const definition of [
        {
            path: '/api/v1/ref-account-types',
            operationId: 'listRefAccountTypes',
            summary: 'List reference account types',
            query: ListRefAccountTypesQuerySchema,
            dto: accountType,
            item: example,
            message: 'Referensi tipe akun berhasil diambil.',
            filter: '',
        },
        {
            path: '/api/v1/ref-categories',
            operationId: 'listRefCategories',
            summary: 'List reference categories',
            query: ListRefCategoriesQuerySchema,
            dto: category,
            item: { ...example, name: 'Gaji', type: 'INCOME' },
            message: 'Referensi kategori berhasil diambil.',
            filter: ' Optional exact type filter: INCOME or EXPENSE.',
        },
    ]) {
        registry.registerPath({
            method: 'get',
            path: definition.path,
            operationId: definition.operationId,
            summary: definition.summary,
            tags: ['References'],
            security: [{ bearerAuth: [] }],
            description:
                'Read-only global seed reference data, shared by all active authenticated users. No RBAC permission required. Does not read or mutate user-owned categories/account types. page defaults to 1; limit defaults to 20 (maximum 100). sort: created_at|-created_at|name|-name, default -created_at, with an ID tie-break in the same direction. Optional case-insensitive name substring. Unknown query keys are rejected.' +
                definition.filter,
            request: { query: definition.query },
            responses: {
                200: {
                    description:
                        'Paginated reference records; empty pages have null from/to and last_page is at least 1.',
                    content: {
                        'application/json': {
                            schema: createSuccessResponseSchema(z.array(definition.dto)).extend({
                                pagination: PaginationSchema,
                            }),
                            example: {
                                success: true,
                                message: definition.message,
                                timestamp: '2026-10-10 10:00:00',
                                total_data: 1,
                                data: [definition.item],
                                pagination: {
                                    total: 1,
                                    per_page: 20,
                                    current_page: 1,
                                    last_page: 1,
                                    from: 1,
                                    to: 1,
                                },
                            },
                        },
                    },
                },
                401: error('Missing/invalid JWT, expired/revoked Redis session, or inactive/deleted user.'),
                422: error('Invalid pagination, sort, name/type filter, or unknown query keys.'),
                429: error('Shared API rate limit exceeded.'),
                500: error('Unexpected dependency failure.'),
            },
        });
    }
}
