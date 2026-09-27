import argon2 from 'argon2';
import type { Express } from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { FakeAuthRepository } from '../helpers/fake-auth-repository.js';
import { FakeAuthSessionStore } from '../helpers/fake-auth-session-store.js';
import { FakeAuthorizationRepository } from '../helpers/fake-authorization-repository.js';
import { FakeUserRepository } from '../helpers/fake-user-repository.js';

const USER_ID = '01995f6c-607b-7000-8000-000000000001';
let passwordHash = '';

beforeAll(async () => {
  passwordHash = await argon2.hash('password-kuat', { type: argon2.argon2id });
});

function testApp(repository = new FakeAuthRepository()) {
  repository.addUser({
    id: USER_ID,
    name: 'Budi Santoso',
    username: 'budi',
    email: 'budi@example.com',
    passwordHash,
    status: 'ACTIVE',
    deletedAt: null,
    roles: ['Super Admin'],
  });
  const sessionStore = new FakeAuthSessionStore();
  return {
    app: createApp({
      userRepository: new FakeUserRepository(),
      authRepository: repository,
      authSessionStore: sessionStore,
      authorizationRepository: new FakeAuthorizationRepository(),
      health: {
        checkDatabase: async () => undefined,
        checkRedis: async () => undefined,
        isShuttingDown: () => false,
      },
    }),
    repository,
    sessionStore,
  };
}

type LoginTokens = {
  access_token: string;
  refresh_token: string;
};

type LoginResponseBody = {
  data: LoginTokens;
};

async function login(app: Express, identifier = 'budi@example.com'): Promise<LoginTokens> {
  const credential = identifier.includes('@') ? { email: identifier } : { username: identifier };
  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ ...credential, password: 'password-kuat' })
    .expect(200);
  return response.body.data as LoginTokens;
}

describe('authentication API with Redis sessions', () => {
  it('logs in by username or email and returns both JWTs without cookies', async () => {
    const { app, sessionStore } = testApp();
    const byUsername = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'budi', password: 'password-kuat' })
      .expect(200);
    const byEmail = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'budi@example.com', password: 'password-kuat' })
      .expect(200);

    for (const response of [byUsername, byEmail]) {
      expect(response.body).toMatchObject({
        success: true,
        message: 'Berhasil masuk.',
        data: {
          user: { id: USER_ID, email: 'budi@example.com', roles: ['Super Admin'] },
          token_type: 'Bearer',
        },
      });
      const body = response.body as LoginResponseBody;
      expect(body.data.access_token.split('.')).toHaveLength(3);
      expect(body.data.refresh_token.split('.')).toHaveLength(3);
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(response.headers['cache-control']).toContain('no-store');
    }
    expect(sessionStore.sessions.size).toBe(2);
  });

  it('returns the same credential error for unknown, inactive, and deleted users', async () => {
    const repository = new FakeAuthRepository();
    repository.addUser({
      id: USER_ID,
      name: 'Budi Santoso',
      email: 'inactive@example.com',
      passwordHash,
      status: 'INACTIVE',
      deletedAt: null,
      roles: [],
    });
    repository.addUser({
      id: '01995f6c-607b-7000-8000-000000000002',
      name: 'Siti Aminah',
      email: 'deleted@example.com',
      passwordHash,
      status: 'ACTIVE',
      deletedAt: new Date(),
      roles: [],
    });
    const { app } = testApp(repository);

    for (const email of ['unknown@example.com', 'inactive@example.com', 'deleted@example.com']) {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password: 'password-kuat' })
        .expect(401);
      expect(response.body.message).toBe('Username/email atau kata sandi tidak valid.');
    }
  });

  it('requires a Redis-registered Bearer token and returns current roles', async () => {
    const { app, repository, sessionStore } = testApp();
    const tokens = await login(app);
    repository.setUserRoles(USER_ID, ['Administrator', 'Auditor']);

    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokens.access_token}`)
      .expect(200);
    expect(me.body.data.roles).toEqual(['Administrator', 'Auditor']);

    sessionStore.sessions.clear();
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokens.access_token}`)
      .expect(401);
    await request(app).get('/api/v1/auth/me').expect(401);
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);
  });

  it('rotates both JWTs from the JSON refresh token and rejects the old access token', async () => {
    const { app } = testApp();
    const oldTokens = await login(app);
    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: oldTokens.refresh_token })
      .expect(200);

    expect(refreshed.body.data.access_token).not.toBe(oldTokens.access_token);
    expect(refreshed.body.data.refresh_token).not.toBe(oldTokens.refresh_token);
    expect(refreshed.headers['set-cookie']).toBeUndefined();
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${oldTokens.access_token}`)
      .expect(401);
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${refreshed.body.data.access_token as string}`)
      .expect(200);
  });

  it('revokes only the replayed session while preserving another login session', async () => {
    const { app, sessionStore } = testApp();
    const first = await login(app);
    const second = await login(app, 'budi');
    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: first.refresh_token })
      .expect(200);

    const replay = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: first.refresh_token })
      .expect(401);
    expect(replay.body.message).toContain('refresh token digunakan kembali');
    expect(sessionStore.sessions.size).toBe(1);
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${refreshed.body.data.access_token as string}`)
      .expect(401);
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${second.access_token}`)
      .expect(200);
  });

  it('logs out only the current access-token session', async () => {
    const { app, sessionStore } = testApp();
    const first = await login(app);
    const second = await login(app, 'budi');

    await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${first.access_token}`)
      .expect(200);

    expect(sessionStore.sessions.size).toBe(1);
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${first.access_token}`)
      .expect(401);
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${second.access_token}`)
      .expect(200);
  });
});
