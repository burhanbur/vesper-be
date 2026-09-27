import { describe, expect, it } from 'vitest';
import { loadConfig } from './env.js';

const BASE_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  CORS_ORIGINS: 'http://localhost:5173',
  JWT_ACCESS_SECRET: 'access-secret-with-at-least-32-characters',
  JWT_REFRESH_SECRET: 'different-refresh-secret-at-least-32-characters',
};

function invalidConfig(overrides: NodeJS.ProcessEnv): string {
  expect(() => loadConfig({ ...BASE_ENV, ...overrides })).toThrowError(
    /Invalid environment configuration/,
  );

  try {
    loadConfig({ ...BASE_ENV, ...overrides });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Expected configuration to be invalid');
}

describe('auth environment configuration', () => {
  it('uses separate access and refresh JWT secrets', () => {
    const config = loadConfig(BASE_ENV);

    expect(config.JWT_ACCESS_SECRET).toBe(BASE_ENV.JWT_ACCESS_SECRET);
    expect(config.JWT_REFRESH_SECRET).toBe(BASE_ENV.JWT_REFRESH_SECRET);
    expect(config.AUTH_ACCESS_TTL_SECONDS).toBe(900);
    expect(config.AUTH_REFRESH_TOKEN_TTL_SECONDS).toBe(604_800);
  });

  it('rejects identical access and refresh JWT secrets', () => {
    expect(invalidConfig({ JWT_REFRESH_SECRET: BASE_ENV.JWT_ACCESS_SECRET })).toContain(
      'JWT_REFRESH_SECRET: must differ from JWT_ACCESS_SECRET',
    );
  });
});
