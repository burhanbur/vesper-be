import { z } from 'zod';

// Never fall back to DATABASE_URL or load dotenv for integration tests.
const IntegrationEnvironmentSchema = z.object({
  NODE_ENV: z.literal('test'),
  VESPER_POSTGRES_INTEGRATION: z.literal('ephemeral-postgres-only'),
  VESPER_INTEGRATION_DATABASE_URL: z.url(),
});

export function integrationDatabaseUrl(): string {
  const input = IntegrationEnvironmentSchema.parse(process.env);
  const url = new URL(input.VESPER_INTEGRATION_DATABASE_URL);
  if (
    url.protocol !== 'postgresql:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    Number(url.port) < 1024 ||
    ['5432', '5433'].includes(url.port) ||
    url.pathname !== '/vesper_integration_test' ||
    url.username !== 'vesper_integration' ||
    url.password !== 'integration-only-not-a-secret' ||
    url.search ||
    url.hash
  )
    throw new Error('Refusing non-isolated PostgreSQL integration target');
  return url.toString();
}
