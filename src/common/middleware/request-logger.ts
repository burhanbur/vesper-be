import { pinoHttp } from 'pino-http';
import { logger } from '../../infrastructure/logger.js';

// The request ID middleware runs first, so pino-http reuses the existing request.id.
export const requestLogger = pinoHttp({ logger });
