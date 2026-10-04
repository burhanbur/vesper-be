import pino from 'pino';
import { config } from '../config/index.js';

export const logger = pino({
  name: config.APP_NAME,
  level: config.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.code',
      'req.body.token',
      'req.body.access_token',
      'req.body.refresh_token',
      'req.body.accessToken',
      'req.body.refreshToken',
      'err.body',
      'password',
      'passwordHash',
      'accessToken',
      'refreshToken',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.secret',
      '*.access_token',
      '*.refresh_token',
      '*.accessToken',
      '*.refreshToken',
    ],
    censor: '[REDACTED]',
  },
  ...(config.NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, singleLine: true, translateTime: 'SYS:standard' },
        },
      }
    : {}),
});
