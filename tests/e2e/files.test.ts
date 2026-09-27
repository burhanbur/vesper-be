import { describe, expect, it } from 'vitest';
import { FakeFileRepository } from '../helpers/fake-file-repository.js';
import { FakeUserRepository } from '../helpers/fake-user-repository.js';
import { MemoryFileStorage } from '../helpers/memory-file-storage.js';
import { createProtectedTestApp, loginTestAgent } from '../helpers/protected-test-app.js';

const FILE_PERMISSIONS = ['file.index', 'file.store', 'file.show', 'file.download', 'file.destroy'];

function testApp() {
  return createProtectedTestApp(
    {
      userRepository: new FakeUserRepository(),
      fileRepository: new FakeFileRepository(),
      fileStorage: new MemoryFileStorage(),
    },
    FILE_PERMISSIONS,
  );
}

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('files API', () => {
  it('uploads, lists, and downloads a validated file', async () => {
    const { app } = await testApp();
    const { agent, accessToken } = await loginTestAgent(app);
    const uploaded = await agent
      .post('/api/v1/files')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', onePixelPng, { filename: 'pixel.png', contentType: 'image/png' })
      .expect(201);

    expect(uploaded.body).toMatchObject({
      success: true,
      message: 'File berhasil diunggah.',
      data: {
        original_name: 'pixel.png',
        mime_type: 'image/png',
        extension: 'png',
        size: onePixelPng.byteLength,
      },
    });
    expect(uploaded.body.data.checksum).toMatch(/^[a-f0-9]{64}$/);

    const listed = await agent
      .get('/api/v1/files')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(listed.body.total_data).toBe(1);

    const fileId = uploaded.body.data.id as string;
    const metadata = await agent
      .get(`/api/v1/files/${fileId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(metadata.body.data.original_name).toBe('pixel.png');

    const downloaded = await agent
      .get(`/api/v1/files/${fileId}/download`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(downloaded.headers['content-type']).toBe('image/png');
    expect(downloaded.body).toEqual(onePixelPng);

    await agent
      .delete(`/api/v1/files/${fileId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    await agent
      .get(`/api/v1/files/${fileId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);
  });

  it('rejects a file whose bytes do not match an allowed type', async () => {
    const { app } = await testApp();
    const { agent, accessToken } = await loginTestAgent(app);
    const response = await agent
      .post('/api/v1/files')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', Buffer.from('not an image'), {
        filename: 'fake.png',
        contentType: 'image/png',
      })
      .expect(422);

    expect(response.body).toMatchObject({
      success: false,
      message: 'Tipe file tidak diizinkan.',
    });
  });

  it('rejects an extension that does not match the detected file signature', async () => {
    const { app } = await testApp();
    const { agent, accessToken } = await loginTestAgent(app);
    const response = await agent
      .post('/api/v1/files')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', onePixelPng, { filename: 'pixel.jpg', contentType: 'image/jpeg' })
      .expect(422);

    expect(response.body).toMatchObject({
      success: false,
      message: 'Ekstensi file tidak sesuai dengan isi file.',
    });
  });
});
