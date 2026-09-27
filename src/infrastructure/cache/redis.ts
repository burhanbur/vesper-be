import { Redis } from 'ioredis';
import { config } from '../../config/index.js';
import { logger } from '../logger.js';

export const redis = new Redis(config.REDIS_URL, {
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  keyPrefix: `${config.APP_NAME}:${config.NODE_ENV}:`,
});

redis.on('error', (error: Error) => {
  logger.error({ err: error }, 'Redis connection error');
});

export async function connectRedis(): Promise<void> {
  if (redis.status === 'wait') {
    await redis.connect();
  }
}

export async function checkRedisConnection(): Promise<void> {
  if (redis.status === 'wait') {
    await redis.connect();
  }
  await redis.ping();
}

export async function disconnectRedis(): Promise<void> {
  if (redis.status !== 'end') {
    redis.disconnect();
  }
}
