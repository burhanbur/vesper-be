import { createServer, type Server } from 'node:http';
import { createApp } from './app.js';
import { config } from './config/index.js';
import { connectRedis, disconnectRedis } from './infrastructure/cache/redis.js';
import { disconnectDatabase } from './infrastructure/database/prisma.js';
import { beginShutdown, isShuttingDown } from './infrastructure/lifecycle.js';
import { logger } from './infrastructure/logger.js';

let server: Server | undefined;

async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (isShuttingDown()) return;
  beginShutdown();
  logger.info({ signal }, 'Graceful shutdown started');

  const forceExit = setTimeout(() => {
    logger.fatal('Graceful shutdown timed out');
    process.exit(1);
  }, config.SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await Promise.allSettled([disconnectDatabase(), disconnectRedis()]);
    clearTimeout(forceExit);
    process.exit(exitCode);
  } catch (error) {
    logger.fatal({ err: error }, 'Graceful shutdown failed');
    process.exit(1);
  }
}

async function bootstrap(): Promise<void> {
  await connectRedis();
  const app = createApp();
  server = createServer(app);
  server.requestTimeout = config.HTTP_REQUEST_TIMEOUT_MS;
  server.headersTimeout = config.HTTP_HEADERS_TIMEOUT_MS;
  server.keepAliveTimeout = config.HTTP_KEEP_ALIVE_TIMEOUT_MS;
  server.listen(config.PORT, config.HOST, () => {
    logger.info({ host: config.HOST, port: config.PORT }, 'HTTP server listening');
  });
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception');
  void shutdown('uncaughtException', 1);
});
process.once('unhandledRejection', (error) => {
  logger.fatal({ err: error }, 'Unhandled rejection');
  void shutdown('unhandledRejection', 1);
});

bootstrap().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Application bootstrap failed');
  void shutdown('bootstrapError', 1);
});
