import ExcelJS from 'exceljs';
import type { Response as SuperagentResponse } from 'superagent';
import { describe, expect, it } from 'vitest';
import { FakeUserRepository } from '../helpers/fake-user-repository.js';
import { createProtectedTestApp, loginTestAgent } from '../helpers/protected-test-app.js';

const USER_PERMISSIONS = ['user.index', 'user.create', 'user.store'];

function testApp() {
  return createProtectedTestApp({ userRepository: new FakeUserRepository() }, USER_PERMISSIONS);
}

async function importWorkbook(rows: [string, string, string, string][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('users');
  worksheet.addRow(['name', 'email', 'password', 'status']);
  for (const row of rows) worksheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function parseBinary(
  response: SuperagentResponse,
  callback: (error: Error | null, body?: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
  response.on('error', (error: Error) => callback(error));
}

function responseBuffer(body: unknown): Buffer {
  if (!Buffer.isBuffer(body)) throw new TypeError('Expected a binary response');
  return body;
}

describe('user Excel API', () => {
  it('downloads an XLSX import template', async () => {
    const { app } = await testApp();
    const { agent, accessToken } = await loginTestAgent(app);
    const response = await agent
      .get('/api/v1/users/import/template')
      .set('Authorization', `Bearer ${accessToken}`)
      .buffer(true)
      .parse(parseBinary)
      .expect(200);

    expect(response.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(response.headers['content-disposition']).toContain('users-import-template.xlsx');
    expect(responseBuffer(response.body).subarray(0, 2).toString()).toBe('PK');
  });

  it('imports validated rows atomically and never returns password data', async () => {
    const { app } = await testApp();
    const { agent, accessToken } = await loginTestAgent(app);
    const workbook = await importWorkbook([
      ['Budi Santoso', 'budi@example.com', 'password-kuat', 'ACTIVE'],
      ['Siti Aminah', 'siti@example.com', 'password-kuat', 'INACTIVE'],
    ]);

    const imported = await agent
      .post('/api/v1/users/import')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', workbook, {
        filename: 'users.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(201);

    expect(imported.body).toMatchObject({
      success: true,
      total_data: 2,
      data: { imported: 2, total_rows: 2 },
    });

    const listed = await agent
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(listed.body.data).toHaveLength(2);
    expect(listed.body.data[0]).not.toHaveProperty('password');
    expect(listed.body.data[0]).not.toHaveProperty('passwordHash');
  });

  it('returns row-level validation errors without importing partial data', async () => {
    const { app } = await testApp();
    const { agent, accessToken } = await loginTestAgent(app);
    const workbook = await importWorkbook([
      ['A', 'invalid-email', 'short', 'UNKNOWN'],
      ['Siti Aminah', 'siti@example.com', 'password-kuat', 'ACTIVE'],
    ]);

    const response = await agent
      .post('/api/v1/users/import')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', workbook, { filename: 'users.xlsx' })
      .expect(422);

    expect(response.body).toMatchObject({
      success: false,
      message: 'Validasi data impor gagal.',
    });
    expect(response.body.errors).toHaveProperty('rows.2');

    const listed = await agent
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(listed.body.total_data).toBe(0);
  });

  it('streams exported users as XLSX without password columns', async () => {
    const { app } = await testApp();
    const { agent, accessToken } = await loginTestAgent(app);
    await agent
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Budi Santoso', email: 'budi@example.com', password: 'password-kuat' })
      .expect(201);

    const response = await agent
      .get('/api/v1/users/export')
      .set('Authorization', `Bearer ${accessToken}`)
      .buffer(true)
      .parse(parseBinary)
      .expect(200);
    const workbook = new ExcelJS.Workbook();
    const exportedWorkbook = responseBuffer(response.body) as unknown as ExcelJS.Buffer;
    await workbook.xlsx.load(exportedWorkbook);
    const worksheet = workbook.getWorksheet('users');

    expect(worksheet?.getRow(1).values).toEqual([
      undefined,
      'id',
      'name',
      'email',
      'status',
      'created_at',
      'updated_at',
    ]);
    expect(worksheet?.getRow(2).getCell(3).value).toBe('budi@example.com');
    expect(worksheet?.columnCount).toBe(6);
  });
});
