import type { Redis } from 'ioredis';
import { constantTimeEqual } from '../../modules/auth/auth.crypto.js';
import type {
  AuthSessionStore,
  CreateAuthSessionInput,
  RefreshRotationResult,
  RotateAuthSessionInput,
} from '../../modules/auth/auth-session.store.js';

const ROTATE_SESSION_SCRIPT = `
local current = redis.call('HGET', KEYS[1], 'refresh_token_digest')
if not current then
  return 0
end
if current ~= ARGV[1] then
  redis.call('DEL', KEYS[1])
  return -1
end
redis.call('HSET', KEYS[1],
  'access_token_digest', ARGV[2],
  'refresh_token_digest', ARGV[3])
redis.call('EXPIREAT', KEYS[1], ARGV[4])
return 1
`;

const REVOKE_BY_ACCESS_SCRIPT = `
local current = redis.call('HGET', KEYS[1], 'access_token_digest')
if not current or current ~= ARGV[1] then
  return 0
end
redis.call('DEL', KEYS[1])
return 1
`;

function sessionKey(userId: string, sessionId: string): string {
  return `auth:session:${userId}:${sessionId}`;
}

function expirationSeconds(expiresAt: Date): number {
  return Math.floor(expiresAt.getTime() / 1_000);
}

export class RedisAuthSessionStore implements AuthSessionStore {
  constructor(private readonly client: Redis) {}

  async createSession(input: CreateAuthSessionInput): Promise<void> {
    await this.client
      .multi()
      .hset(
        sessionKey(input.userId, input.sessionId),
        'access_token_digest',
        input.accessTokenDigest,
        'refresh_token_digest',
        input.refreshTokenDigest,
      )
      .expireat(sessionKey(input.userId, input.sessionId), expirationSeconds(input.expiresAt))
      .exec();
  }

  async isAccessTokenActive(input: {
    userId: string;
    sessionId: string;
    accessTokenDigest: string;
  }): Promise<boolean> {
    const storedDigest = await this.client.hget(
      sessionKey(input.userId, input.sessionId),
      'access_token_digest',
    );
    return storedDigest !== null && constantTimeEqual(storedDigest, input.accessTokenDigest);
  }

  async rotateSession(input: RotateAuthSessionInput): Promise<RefreshRotationResult> {
    const result = Number(
      await this.client.eval(
        ROTATE_SESSION_SCRIPT,
        1,
        sessionKey(input.userId, input.sessionId),
        input.expectedRefreshTokenDigest,
        input.accessTokenDigest,
        input.refreshTokenDigest,
        expirationSeconds(input.expiresAt),
      ),
    );
    if (result === 1) return 'rotated';
    if (result === -1) return 'reused';
    return 'invalid';
  }

  async revokeSessionByAccessToken(input: {
    userId: string;
    sessionId: string;
    accessTokenDigest: string;
  }): Promise<boolean> {
    const result = await this.client.eval(
      REVOKE_BY_ACCESS_SCRIPT,
      1,
      sessionKey(input.userId, input.sessionId),
      input.accessTokenDigest,
    );
    return Number(result) === 1;
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    await this.client.del(sessionKey(userId, sessionId));
  }
}
