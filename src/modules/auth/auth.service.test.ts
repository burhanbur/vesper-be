import { describe, expect, it } from 'vitest';
import { FakeAuthRepository } from '../../../tests/helpers/fake-auth-repository.js';
import { FakeAuthSessionStore } from '../../../tests/helpers/fake-auth-session-store.js';
import { AuthService } from './auth.service.js';
import { AuthTokenService } from './auth-token.service.js';

const USER_ID = '01995f6c-607b-7000-8000-000000000001';

function createFixture() {
  const now = new Date('2026-09-20T00:00:00.000Z');
  const repository = new FakeAuthRepository();
  repository.addUser({
    id: USER_ID,
    name: 'Budi Santoso',
    username: 'budi',
    email: 'budi@example.com',
    passwordHash: 'verified-by-fake',
    status: 'ACTIVE',
    deletedAt: null,
    roles: ['User'],
  });
  const sessionStore = new FakeAuthSessionStore(() => now);
  const tokenService = new AuthTokenService({
    accessSecret: 'test-access-secret-with-at-least-32-characters',
    refreshSecret: 'test-refresh-secret-different-from-access',
    issuer: 'test',
    audience: 'test-api',
    now: () => now,
  });
  const service = new AuthService({
    repository,
    sessionStore,
    tokenService,
    now: () => now,
    verifyPassword: async () => true,
    options: {
      AUTH_ACCESS_TTL_SECONDS: 900,
      AUTH_REFRESH_TOKEN_TTL_SECONDS: 604_800,
    },
  });

  return { service, repository, sessionStore };
}

describe('AuthService Redis sessions', () => {
  it('supports login by username and registers token digests', async () => {
    const { service, sessionStore } = createFixture();
    const result = await service.login({ username: 'budi', password: 'password-kuat' });

    expect(result.user.id).toBe(USER_ID);
    expect(result.tokens.accessToken.split('.')).toHaveLength(3);
    expect(result.tokens.refreshToken.split('.')).toHaveLength(3);
    expect(sessionStore.sessions.size).toBe(1);
    const session = [...sessionStore.sessions.values()][0];
    expect(session?.accessTokenDigest).toMatch(/^[a-f\d]{64}$/);
    expect(session?.refreshTokenDigest).toMatch(/^[a-f\d]{64}$/);
    expect(session?.accessTokenDigest).not.toContain(result.tokens.accessToken);
  });

  it('validates access tokens against the session store', async () => {
    const { service, sessionStore } = createFixture();
    const login = await service.login({ email: 'budi@example.com', password: 'password-kuat' });

    await expect(service.authenticate(login.tokens.accessToken)).resolves.toMatchObject({
      id: USER_ID,
      roles: ['User'],
    });
    sessionStore.sessions.clear();
    await expect(service.authenticate(login.tokens.accessToken)).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
    });
  });

  it('rotates both tokens and revokes a session on refresh replay', async () => {
    const { service, sessionStore } = createFixture();
    const login = await service.login({ email: 'budi@example.com', password: 'password-kuat' });
    const refreshed = await service.refresh(login.tokens.refreshToken);

    expect(refreshed.tokens.accessToken).not.toBe(login.tokens.accessToken);
    expect(refreshed.tokens.refreshToken).not.toBe(login.tokens.refreshToken);
    await expect(service.authenticate(login.tokens.accessToken)).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
    });
    await expect(service.refresh(login.tokens.refreshToken)).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_REUSED',
    });
    expect(sessionStore.sessions.size).toBe(0);
    await expect(service.authenticate(refreshed.tokens.accessToken)).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
    });
  });

  it('revokes only the session represented by the logout access token', async () => {
    const { service, sessionStore } = createFixture();
    const first = await service.login({ email: 'budi@example.com', password: 'password-kuat' });
    const second = await service.login({ username: 'budi', password: 'password-kuat' });
    expect(sessionStore.sessions.size).toBe(2);

    await service.logout(first.tokens.accessToken);

    expect(sessionStore.sessions.size).toBe(1);
    await expect(service.authenticate(first.tokens.accessToken)).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
    });
    await expect(service.authenticate(second.tokens.accessToken)).resolves.toMatchObject({
      id: USER_ID,
    });
  });
});
