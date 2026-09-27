import { rateLimit } from 'express-rate-limit';
import { config } from '../../config/index.js';
import { sendError } from '../http/api-response.js';

export const apiRateLimit = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  limit: config.RATE_LIMIT_MAX,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (request, response) =>
    sendError(request, response, {
      statusCode: 429,
      message: 'Terlalu banyak permintaan. Silakan coba lagi nanti.',
    }),
});
