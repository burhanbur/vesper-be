import type { RequestHandler } from 'express';
import { sendSuccess } from '../../common/http/api-response.js';
import type { ValidatedInput } from '../../common/middleware/validate.js';
import type { ListRefAccountTypesQuery, ListRefCategoriesQuery } from './reference.schema.js';
import type { ReferenceService } from './reference.service.js';

export function createReferenceController(service: ReferenceService) {
    // Authentication and query validation establish these locals before execution.
    const listAccountTypes: RequestHandler = async (request, response) => {
        const validated = response.locals.validated as ValidatedInput;
        const result = await service.listAccountTypes(validated.query as ListRefAccountTypesQuery);
        response.set('Cache-Control', 'no-store');
        sendSuccess(request, response, {
            data: result.items,
            pagination: result.pagination,
            message: 'Referensi tipe akun berhasil diambil.',
        });
    };
    const listCategories: RequestHandler = async (request, response) => {
        const validated = response.locals.validated as ValidatedInput;
        const result = await service.listCategories(validated.query as ListRefCategoriesQuery);
        response.set('Cache-Control', 'no-store');
        sendSuccess(request, response, {
            data: result.items,
            pagination: result.pagination,
            message: 'Referensi kategori berhasil diambil.',
        });
    };
    return { listAccountTypes, listCategories };
}
