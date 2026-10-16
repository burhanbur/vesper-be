import { Router } from 'express';
import { z } from '../../common/openapi/zod.js';
import { validateRequest } from '../../common/middleware/validate.js';
import { sendSuccess } from '../../common/http/api-response.js';
import { createRequireAuthentication } from '../auth/auth.middleware.js';
import type { AuthService } from '../auth/auth.service.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import type { CollaborationRepository } from './collaboration.repository.js';
import { GroupParamsSchema, GroupPageSchema, GroupReportQuerySchema } from './group.schema.js';

export const CollaborationQuerySchema = GroupPageSchema.extend(GroupReportQuerySchema.shape);
export const MembershipActionSchema = z.strictObject({
  user_id: z.uuid(),
  action: z.enum(['REMOVE', 'TRANSFER_OWNER']),
});
export const CollaborationDtoSchema = z.strictObject({
  period: z.string(),
  page: z.number(),
  limit: z.number(),
  balances: z.array(z.strictObject({ currency: z.string(), balance: z.string() })),
  contributions: z.array(
    z.strictObject({
      user_id: z.uuid(),
      currency: z.string(),
      income: z.string(),
      expense: z.string(),
    }),
  ),
  feed: z.array(
    z.strictObject({
      id: z.uuid(),
      user_id: z.uuid(),
      currency: z.string(),
      amount: z.string(),
      type: z.string(),
      category: z.string(),
      transacted_at: z.iso.datetime(),
    }),
  ),
});

export function createCollaborationRouter(repository: CollaborationRepository, auth: AuthService) {
  const router = Router();
  router.use(createRequireAuthentication(auth));
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.get(
    '/:id/collaboration',
    validateRequest({ params: GroupParamsSchema, query: CollaborationQuerySchema }),
    async (req, res) => {
      const actor = (res.locals.auth as AuthPrincipal).id;
      const { period, page, limit } = CollaborationQuerySchema.parse(req.query);
      const data = await repository.read(
        actor,
        GroupParamsSchema.parse(req.params).id,
        period,
        page,
        limit,
      );
      sendSuccess(req, res, { data, message: 'Kolaborasi grup berhasil diambil.' });
    },
  );
  router.post(
    '/:id/membership',
    validateRequest({ params: GroupParamsSchema, body: MembershipActionSchema }),
    async (req, res) => {
      const { user_id, action } = MembershipActionSchema.parse(req.body);
      await repository.manage(
        (res.locals.auth as AuthPrincipal).id,
        GroupParamsSchema.parse(req.params).id,
        user_id,
        action,
      );
      sendSuccess(req, res, { data: null, message: 'Keanggotaan berhasil diperbarui.' });
    },
  );
  return router;
}
