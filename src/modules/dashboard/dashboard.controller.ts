import type { RequestHandler } from 'express';
import { sendSuccess } from '../../common/http/api-response.js';
import type { ValidatedInput } from '../../common/middleware/validate.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import type { DashboardSummaryQuery } from './dashboard.schema.js';
import type { DashboardService } from './dashboard.service.js';

export function createDashboardController(service: DashboardService) {
  const summary: RequestHandler = async (request, response) => {
    // Authentication and validation establish these locals before controller execution.
    const principal = response.locals.auth as AuthPrincipal;
    const input = response.locals.validated as ValidatedInput;
    const data = await service.summary(principal.id, input.query as DashboardSummaryQuery);
    response.set('Cache-Control', 'no-store');
    sendSuccess(request, response, { data, message: 'Ringkasan dashboard berhasil diambil.' });
  };
  return { summary };
}
