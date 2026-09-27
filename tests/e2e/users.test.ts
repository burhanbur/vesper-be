import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { FakeUserRepository } from '../helpers/fake-user-repository.js';
import {
  createProtectedTestApp,
  loginTestAgent,
  TEST_AUTH_USER_ID,
} from '../helpers/protected-test-app.js';

const USER_PERMISSIONS = ['user.index', 'user.create', 'user.store', 'user.update', 'user.destroy'];

function testApp(permissions = USER_PERMISSIONS) {
  return createProtectedTestApp({ userRepository: new FakeUserRepository() }, permissions);
}

describe('users API', () => {
  it('creates and lists users without exposing password hashes', async () => {
    const { app } = await testApp();
    const { agent, accessToken } = await loginTestAgent(app);
    const created = await agent
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Budi Santoso', email: 'budi@example.com', password: 'password-kuat' })
      .expect(201);

    expect(created.body).toMatchObject({
      success: true,
      message: 'Pengguna berhasil dibuat.',
      total_data: 1,
      data: { name: 'Budi Santoso', email: 'budi@example.com', status: 'ACTIVE' },
    });
    expect(created.body.data).not.toHaveProperty('password');
    expect(created.body.data).not.toHaveProperty('passwordHash');

    const listed = await agent
      .get('/api/v1/users?page=1&limit=20')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(listed.body).toMatchObject({
      success: true,
      total_data: 1,
      pagination: {
        total: 1,
        per_page: 20,
        current_page: 1,
        last_page: 1,
        from: 1,
        to: 1,
      },
    });
    expect(listed.body.data).toHaveLength(1);
  });

  it('returns validation errors in the Laravel-compatible error envelope', async () => {
    const { app } = await testApp();
    const { agent, accessToken } = await loginTestAgent(app);
    const response = await agent
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'A', email: 'invalid', password: 'short' })
      .expect(422);

    expect(response.body).toMatchObject({
      success: false,
      message: 'Validasi gagal. Silakan periksa kembali input Anda.',
      debug: { method: 'POST' },
    });
    expect(response.body.errors).toHaveProperty('body');
  });

  it('returns a standardized not-found response', async () => {
    const { app } = await testApp();
    const { agent, accessToken } = await loginTestAgent(app);
    const response = await agent
      .get('/api/v1/users/018f3f1e-7b2f-7cc6-8ff8-8eaa5646f135')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);

    expect(response.body).toMatchObject({
      success: false,
      message: 'Pengguna tidak ditemukan.',
    });
  });

  it('denies anonymous access and applies permission revocation immediately', async () => {
    const { app, authorizationRepository } = await testApp(['user.index']);
    const anonymous = await request(app).get('/api/v1/users').expect(401);
    expect(anonymous.body).toMatchObject({
      success: false,
      message: 'Sesi tidak valid atau telah berakhir. Silakan masuk kembali.',
    });

    const { agent, accessToken } = await loginTestAgent(app);
    await agent.get('/api/v1/users').set('Authorization', `Bearer ${accessToken}`).expect(200);
    authorizationRepository.revoke(TEST_AUTH_USER_ID, 'user.index');
    const denied = await agent
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
    expect(denied.body).toMatchObject({
      success: false,
      message: 'Anda tidak memiliki izin untuk melakukan tindakan ini.',
    });
  });

  it('rejects malformed authorization header and unauthenticated requests', async () => {
    const { app } = await testApp();
    await request(app).get('/api/v1/users').set('Authorization', 'Basic invalid').expect(401);
  });

  it('returns a safe API error for malformed JSON', async () => {
    const { app } = await testApp();
    const response = await request(app)
      .post('/api/v1/users')
      .set('content-type', 'application/json')
      .send('{"name":')
      .expect(400);

    expect(response.body).toMatchObject({
      success: false,
      message: 'Format JSON tidak valid.',
    });
  });

  it('rejects request bodies above the configured limit', async () => {
    const { app } = await testApp();
    const response = await request(app)
      .post('/api/v1/users')
      .send({
        name: 'A'.repeat(2_000),
        email: 'budi@example.com',
        password: 'password-kuat',
      })
      .expect(413);

    expect(response.body).toMatchObject({
      success: false,
      message: 'Ukuran permintaan terlalu besar.',
    });
  });
});
