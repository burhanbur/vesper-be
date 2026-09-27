export type CreateAuthSessionInput = {
  userId: string;
  sessionId: string;
  accessTokenDigest: string;
  refreshTokenDigest: string;
  expiresAt: Date;
};

export type RotateAuthSessionInput = CreateAuthSessionInput & {
  expectedRefreshTokenDigest: string;
};

export type RefreshRotationResult = 'rotated' | 'reused' | 'invalid';

export interface AuthSessionStore {
  createSession(input: CreateAuthSessionInput): Promise<void>;
  isAccessTokenActive(input: {
    userId: string;
    sessionId: string;
    accessTokenDigest: string;
  }): Promise<boolean>;
  rotateSession(input: RotateAuthSessionInput): Promise<RefreshRotationResult>;
  revokeSessionByAccessToken(input: {
    userId: string;
    sessionId: string;
    accessTokenDigest: string;
  }): Promise<boolean>;
  revokeSession(userId: string, sessionId: string): Promise<void>;
}
