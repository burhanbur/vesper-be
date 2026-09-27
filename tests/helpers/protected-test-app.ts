import argon2 from 'argon2';
import request from 'supertest';
import { createApp, type AppDependencies } from '../../src/app.js';
import { FakeAuthRepository } from './fake-auth-repository.js';
import { FakeAuthSessionStore } from './fake-auth-session-store.js';
import { FakeAuthorizationRepository } from './fake-authorization-repository.js';

export const TEST_ORIGIN = 'http://localhost:3000';
export const TEST_AUTH_USER_ID = '01995f6c-607b-7000-8000-000000000001';
export const TEST_AUTH_EMAIL = 'auth@example.com';
export const TEST_AUTH_PASSWORD = 'password-kuat';

let passwordHashPromise: Promise<string> | undefined;

function getPasswordHash(): Promise<string> {
  passwordHashPromise ??= argon2.hash(TEST_AUTH_PASSWORD, { type: argon2.argon2id });
  return passwordHashPromise;
}

export async function createProtectedTestApp(
  dependencies: Pick<AppDependencies, 'userRepository'> &
    Partial<Pick<AppDependencies, 'fileRepository' | 'fileStorage'>>,
  permissions: string[],
) {
  const authRepository = new FakeAuthRepository();
  authRepository.addUser({
    id: TEST_AUTH_USER_ID,
    name: 'Test Operator',
    email: TEST_AUTH_EMAIL,
    passwordHash: await getPasswordHash(),
    status: 'ACTIVE',
    deletedAt: null,
    roles: ['Super Admin'],
  });
  const authorizationRepository = new FakeAuthorizationRepository();
  authorizationRepository.grant(TEST_AUTH_USER_ID, ...permissions);
  const app = createApp({
    ...dependencies,
    authRepository,
    authSessionStore: new FakeAuthSessionStore(),
    authorizationRepository,
    health: {
      checkDatabase: async () => undefined,
      checkRedis: async () => undefined,
      isShuttingDown: () => false,
    },
  });

  return { app, authRepository, authorizationRepository };
}

export async function loginTestAgent(app: ReturnType<typeof createApp>) {
  const agent = request.agent(app);
  const login = await agent
    .post('/api/v1/auth/login')
    .set('Origin', TEST_ORIGIN)
    .send({ email: TEST_AUTH_EMAIL, password: TEST_AUTH_PASSWORD })
    .expect(200);

  const accessToken = login.body.data.access_token as string;
  const refreshToken = login.body.data.refresh_token as string;

  return { agent, accessToken, refreshToken };
}
