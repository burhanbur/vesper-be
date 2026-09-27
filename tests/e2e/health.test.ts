import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { FakeAuthRepository } from '../helpers/fake-auth-repository.js';
import { FakeAuthSessionStore } from '../helpers/fake-auth-session-store.js';
import { FakeAuthorizationRepository } from '../helpers/fake-authorization-repository.js';
import { FakeUserRepository } from '../helpers/fake-user-repository.js';

function testApp() {
  return createApp({
    userRepository: new FakeUserRepository(),
    authRepository: new FakeAuthRepository(),
    authSessionStore: new FakeAuthSessionStore(),
    authorizationRepository: new FakeAuthorizationRepository(),
    health: {
      checkDatabase: async () => undefined,
      checkRedis: async () => undefined,
      isShuttingDown: () => false,
    },
  });
}

describe('health endpoints', () => {
  it('returns the Laravel-compatible success envelope', async () => {
    const response = await request(testApp()).get('/health/live').expect(200);

    expect(response.body).toMatchObject({
      success: true,
      message: 'Layanan aktif.',
      total_data: 1,
      data: { status: 'ok' },
      debug: { method: 'GET' },
    });
    expect(response.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it('returns a standardized readiness error', async () => {
    const app = createApp({
      userRepository: new FakeUserRepository(),
      authRepository: new FakeAuthRepository(),
      authSessionStore: new FakeAuthSessionStore(),
      authorizationRepository: new FakeAuthorizationRepository(),
      health: {
        checkDatabase: async () => Promise.reject(new Error('Database unavailable')),
        checkRedis: async () => undefined,
        isShuttingDown: () => false,
      },
    });
    const response = await request(app).get('/health/ready').expect(503);

    expect(response.body).toMatchObject({
      success: false,
      message: 'Layanan belum siap menerima permintaan.',
      debug: {
        method: 'GET',
        original_message: 'Layanan belum siap menerima permintaan.',
      },
    });
  });

  it('stops reporting readiness during graceful shutdown', async () => {
    const app = createApp({
      userRepository: new FakeUserRepository(),
      authRepository: new FakeAuthRepository(),
      authSessionStore: new FakeAuthSessionStore(),
      authorizationRepository: new FakeAuthorizationRepository(),
      health: {
        checkDatabase: async () => undefined,
        checkRedis: async () => undefined,
        isShuttingDown: () => true,
      },
    });

    const response = await request(app).get('/health/ready').expect(503);

    expect(response.body).toMatchObject({
      success: false,
      message: 'Layanan belum siap menerima permintaan.',
    });
  });
});
