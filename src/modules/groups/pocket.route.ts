import { Router, type RequestHandler } from 'express';
import { sendSuccess } from '../../common/http/api-response.js';
import { validateRequest } from '../../common/middleware/validate.js';
import { createRequireAuthentication } from '../auth/auth.middleware.js';
import type { AuthService } from '../auth/auth.service.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import type { PocketRepository } from './pocket.repository.js';
import { CreatePocketSchema, PocketAccountInputSchema, PocketGroupParamsSchema, PocketParamsSchema } from './pocket.schema.js';

export function createPocketRouter(repository: PocketRepository, auth: AuthService): Router {
    const router = Router();
    const actor = (response: Parameters<RequestHandler>[1]) => (response.locals.auth as AuthPrincipal).id;
    router.use(createRequireAuthentication(auth));
    router.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
    router.get('/:groupId/pockets', validateRequest({ params: PocketGroupParamsSchema }), async (request, response) => {
        const data = await repository.read(actor(response), PocketGroupParamsSchema.parse(request.params).groupId);
        sendSuccess(request, response, { data, message: 'Kantong grup berhasil diambil.' });
    });
    router.post('/:groupId/pockets', validateRequest({ params: PocketGroupParamsSchema, body: CreatePocketSchema }), async (request, response) => {
        const data = await repository.create(actor(response), PocketGroupParamsSchema.parse(request.params).groupId, CreatePocketSchema.parse(request.body));
        sendSuccess(request, response, { data, statusCode: 201, message: 'Kantong grup berhasil dibuat.' });
    });
    const assign = (remove: boolean): RequestHandler => async (request, response) => {
        const { groupId, pocketId } = PocketParamsSchema.parse(request.params);
        await repository.assign(actor(response), groupId, pocketId, PocketAccountInputSchema.parse(request.body).account_id, remove);
        sendSuccess(request, response, { data: null, message: 'Tautan kantong berhasil diperbarui.' });
    };
    router.post('/:groupId/pockets/:pocketId/accounts', validateRequest({ params: PocketParamsSchema, body: PocketAccountInputSchema }), assign(false));
    router.delete('/:groupId/pockets/:pocketId/accounts', validateRequest({ params: PocketParamsSchema, body: PocketAccountInputSchema }), assign(true));
    return router;
}
