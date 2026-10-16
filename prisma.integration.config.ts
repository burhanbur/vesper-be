import { defineConfig } from 'prisma/config';
import { integrationDatabaseUrl } from './src/config/integration-test.js';

// Deliberately does not import dotenv/config or the application Prisma config.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: integrationDatabaseUrl() },
});
