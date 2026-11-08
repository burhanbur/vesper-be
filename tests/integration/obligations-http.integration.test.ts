import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { integrationDatabaseUrl } from '../../src/config/integration-test.js';
import { config } from '../../src/config/index.js';
import { generateId } from '../../src/common/utils/id.js';
import { errorHandler } from '../../src/common/middleware/error-handler.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { syncClient } from '../../src/infrastructure/database/sync-publication.js';
import { PrismaAuthUserRepository } from '../../src/modules/auth/auth-user.repository.js';
import { createAuthService } from '../../src/modules/auth/auth.route.js';
import { PrismaAccountRepository } from '../../src/modules/accounts/account.repository.js';
import { createAccountRouter } from '../../src/modules/accounts/account.route.js';
import { ObligationRepository } from '../../src/modules/obligations/obligation.repository.js';
import { createObligationRouter } from '../../src/modules/obligations/obligation.route.js';
import { FakeAuthSessionStore } from '../helpers/fake-auth-session-store.js';

// Never load .env or construct the application's default Prisma/Redis clients.
vi.mock('../../src/config/index.js', async () => {
  const { loadConfig } = await import('../../src/config/env.js');
  const { integrationDatabaseUrl } = await import('../../src/config/integration-test.js');
  return {
    config: loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: integrationDatabaseUrl(),
      REDIS_URL: 'redis://127.0.0.1:1',
      CORS_ORIGINS: 'http://integration.invalid',
      JWT_ACCESS_SECRET: 'isolated-http-access-fixture-only-0000',
      JWT_REFRESH_SECRET: 'isolated-http-refresh-fixture-only-0000',
      LOG_LEVEL: 'silent',
    }),
  };
});

const client = new PrismaClient({
  adapter: new PrismaPg({ connectionString: integrationDatabaseUrl() }),
});
// Route-level HTTP integration, not the full createApp middleware stack or real Redis auth.
// Mirror createApp's sync-published repository injection without importing default clients.
const published = syncClient(client);
const auth = createAuthService(
  new PrismaAuthUserRepository(client),
  new FakeAuthSessionStore(),
  config,
);
const app = express();
app.use(express.json());
app.use('/api/v1/accounts', createAccountRouter(new PrismaAccountRepository(published), auth));
app.use('/api/v1/obligations', createObligationRouter(new ObligationRepository(published), auth));
app.use(errorHandler);

beforeAll(async () => {
  expect(
    await client.$queryRaw`SELECT current_database() AS database, current_user AS username`,
  ).toEqual([{ database: 'vesper_integration_test', username: 'vesper_integration' }]);
});
afterAll(async () => client.$disconnect());

it('authenticates, validates and scopes web loan records while replaying financial writes once', async () => {
  const session = await auth.register({
    name: 'Loan owner',
    email: generateId() + '@example.invalid',
    password: 'Isolated-test-password-123!',
  });
  const other = await auth.register({
    name: 'Other owner',
    email: generateId() + '@example.invalid',
    password: 'Isolated-test-password-123!',
  });
  const authorization = 'Bearer ' + session.tokens.accessToken;
  const otherAuthorization = 'Bearer ' + other.tokens.accessToken;
  const typeId = generateId();
  await client.accountType.create({ data: { id: typeId, userId: session.user.id, name: 'Cash' } });
  const bankResponse = await request(app)
    .post('/api/v1/accounts')
    .set('Authorization', authorization)
    .send({ name: 'Bank', account_type_id: typeId })
    .expect(201);
  const bank = z.object({ data: z.object({ id: z.uuid() }) }).parse(bankResponse.body).data;
  await request(app).get('/api/v1/obligations').expect(401);
  await request(app)
    .post('/api/v1/obligations/commands')
    .set('Authorization', authorization)
    .send({})
    .expect(422);
  const body = {
    id: generateId(),
    command: {
      action: 'OPEN',
      obligation_id: generateId(),
      kind: 'PAYABLE',
      counterparty: 'Budi',
      currency: 'IDR',
      principal: '500000.00',
      due_date: null,
      installments: [],
      cash_account_id: bank.id,
      linked_account_id: null,
      ledger_ids: {
        cash_principal: generateId(),
        mapped_principal: generateId(),
        interest: generateId(),
        fee: generateId(),
      },
      transacted_at: '2026-11-08T00:00:00.000Z',
    },
  };
  for (let attempt = 0; attempt < 2; attempt++)
    await request(app)
      .post('/api/v1/obligations/commands')
      .set('Authorization', authorization)
      .send(body)
      .expect(200);
  expect(
    (await client.account.findUniqueOrThrow({ where: { id: bank.id } })).balance.toFixed(2),
  ).toBe('500000.00');
  const mine = await request(app)
    .get('/api/v1/obligations')
    .set('Authorization', authorization)
    .expect(200);
  expect(mine.body.data).toMatchObject([
    { kind: 'PAYABLE', outstanding: '500000.00', counterparty: 'Budi' },
  ]);
  const foreign = await request(app)
    .get('/api/v1/obligations')
    .set('Authorization', otherAuthorization)
    .expect(200);
  expect(foreign.body.data).toEqual([]);
  await request(app)
    .get('/api/v1/obligations/' + body.command.obligation_id + '/events')
    .set('Authorization', otherAuthorization)
    .expect(404);
  const events = await request(app)
    .get('/api/v1/obligations/' + body.command.obligation_id + '/events')
    .set('Authorization', authorization)
    .expect(200);
  expect(events.body.data).toHaveLength(1);
  await request(app)
    .post('/api/v1/obligations/commands')
    .set('Authorization', otherAuthorization)
    .send(body)
    .expect(409);
  expect(await client.transaction.count({ where: { accountId: bank.id } })).toBe(1);
});
