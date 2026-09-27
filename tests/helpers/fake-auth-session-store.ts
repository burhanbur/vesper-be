import type {
  AuthSessionStore,
  CreateAuthSessionInput,
  RefreshRotationResult,
  RotateAuthSessionInput,
} from '../../src/modules/auth/auth-session.store.js';
import { constantTimeEqual } from '../../src/modules/auth/auth.crypto.js';

type SessionState = CreateAuthSessionInput;

function key(userId: string, sessionId: string): string {
  return `${userId}:${sessionId}`;
}

export class FakeAuthSessionStore implements AuthSessionStore {
  readonly sessions = new Map<string, SessionState>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async createSession(input: CreateAuthSessionInput): Promise<void> {
    this.sessions.set(key(input.userId, input.sessionId), { ...input });
  }

  async isAccessTokenActive(input: {
    userId: string;
    sessionId: string;
    accessTokenDigest: string;
  }): Promise<boolean> {
    const session = this.sessions.get(key(input.userId, input.sessionId));
    return Boolean(
      session &&
      session.expiresAt > this.now() &&
      constantTimeEqual(session.accessTokenDigest, input.accessTokenDigest),
    );
  }

  async rotateSession(input: RotateAuthSessionInput): Promise<RefreshRotationResult> {
    const sessionKey = key(input.userId, input.sessionId);
    const session = this.sessions.get(sessionKey);
    if (!session || session.expiresAt <= this.now()) return 'invalid';
    if (!constantTimeEqual(session.refreshTokenDigest, input.expectedRefreshTokenDigest)) {
      this.sessions.delete(sessionKey);
      return 'reused';
    }
    this.sessions.set(sessionKey, { ...input });
    return 'rotated';
  }

  async revokeSessionByAccessToken(input: {
    userId: string;
    sessionId: string;
    accessTokenDigest: string;
  }): Promise<boolean> {
    const sessionKey = key(input.userId, input.sessionId);
    const session = this.sessions.get(sessionKey);
    if (!session || !constantTimeEqual(session.accessTokenDigest, input.accessTokenDigest)) {
      return false;
    }
    this.sessions.delete(sessionKey);
    return true;
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    this.sessions.delete(key(userId, sessionId));
  }
}
