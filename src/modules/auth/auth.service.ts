import argon2 from 'argon2';
import { AppError } from '../../common/errors/app-error.js';
import { generateId } from '../../common/utils/id.js';
import type { AppConfig } from '../../config/env.js';
import type { AuthUserRepository } from './auth-user.repository.js';
import { digestToken } from './auth.crypto.js';
import type { LoginInput } from './auth.schema.js';
import type { AuthSessionStore } from './auth-session.store.js';
import type { AccessClaims, RefreshClaims } from './auth-token.service.js';
import {
  toAuthUserDto,
  type AuthPrincipal,
  type AuthResult,
  type AuthTokens,
} from './auth.types.js';

const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$D3hbkxL31HBvhccUbxHGpg$CVwp2eRJHKniiSEeXYL42GBBaoGyHZczL8u/vb9YaTU';

export type AuthServiceOptions = Pick<
  AppConfig,
  'AUTH_ACCESS_TTL_SECONDS' | 'AUTH_REFRESH_TOKEN_TTL_SECONDS'
>;

type SignTokenInput = {
  userId: string;
  sessionId: string;
  issuedAt: Date;
  expiresAt: Date;
};

type AuthTokenProvider = {
  signAccessToken(input: SignTokenInput): Promise<string>;
  signRefreshToken(input: SignTokenInput): Promise<string>;
  verifyAccessToken(token: string): Promise<AccessClaims | null>;
  verifyRefreshToken(token: string): Promise<RefreshClaims | null>;
};

type AuthServiceDependencies = {
  repository: AuthUserRepository;
  sessionStore: AuthSessionStore;
  tokenService: AuthTokenProvider;
  options: AuthServiceOptions;
  now?: () => Date;
  verifyPassword?: (hash: string, password: string) => Promise<boolean>;
};

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1_000);
}

function unauthenticated(): AppError {
  return new AppError({
    statusCode: 401,
    code: 'AUTHENTICATION_REQUIRED',
    message: 'Sesi tidak valid atau telah berakhir. Silakan masuk kembali.',
  });
}

export class AuthService {
  private readonly now: () => Date;
  private readonly verifyPassword: (hash: string, password: string) => Promise<boolean>;

  constructor(private readonly dependencies: AuthServiceDependencies) {
    this.now = dependencies.now ?? (() => new Date());
    this.verifyPassword = dependencies.verifyPassword ?? argon2.verify;
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const identifier = 'username' in input ? input.username : input.email;
    const user = await this.dependencies.repository.findLoginUser(identifier);
    const isPasswordValid = await this.verifyPassword(
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
      input.password,
    );
    if (!user || !isPasswordValid || user.status !== 'ACTIVE' || user.deletedAt) {
      throw new AppError({
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Username/email atau kata sandi tidak valid.',
      });
    }

    const tokens = await this.issueTokens(user.id, generateId(), this.now());
    await this.dependencies.sessionStore.createSession({
      userId: user.id,
      sessionId: tokens.sessionId,
      accessTokenDigest: digestToken(tokens.value.accessToken),
      refreshTokenDigest: digestToken(tokens.value.refreshToken),
      expiresAt: tokens.value.refreshExpiresAt,
    });

    return { user: toAuthUserDto(user), tokens: tokens.value };
  }

  async refresh(refreshToken: string | undefined): Promise<AuthResult> {
    if (!refreshToken) throw unauthenticated();
    const claims = await this.dependencies.tokenService.verifyRefreshToken(refreshToken);
    if (!claims) throw unauthenticated();

    const user = await this.dependencies.repository.findActiveUserById(claims.sub);
    if (!user) {
      await this.dependencies.sessionStore.revokeSession(claims.sub, claims.sid);
      throw unauthenticated();
    }

    const next = await this.issueTokens(claims.sub, claims.sid, this.now());
    const result = await this.dependencies.sessionStore.rotateSession({
      userId: claims.sub,
      sessionId: claims.sid,
      expectedRefreshTokenDigest: digestToken(refreshToken),
      accessTokenDigest: digestToken(next.value.accessToken),
      refreshTokenDigest: digestToken(next.value.refreshToken),
      expiresAt: next.value.refreshExpiresAt,
    });
    if (result === 'reused') {
      throw new AppError({
        statusCode: 401,
        code: 'REFRESH_TOKEN_REUSED',
        message: 'Sesi dicabut karena refresh token digunakan kembali. Silakan masuk kembali.',
      });
    }
    if (result === 'invalid') throw unauthenticated();

    return { user: toAuthUserDto(user), tokens: next.value };
  }

  async authenticate(accessToken: string | undefined): Promise<AuthPrincipal> {
    if (!accessToken) throw unauthenticated();
    const claims = await this.dependencies.tokenService.verifyAccessToken(accessToken);
    if (!claims) throw unauthenticated();

    const active = await this.dependencies.sessionStore.isAccessTokenActive({
      userId: claims.sub,
      sessionId: claims.sid,
      accessTokenDigest: digestToken(accessToken),
    });
    if (!active) throw unauthenticated();

    const user = await this.dependencies.repository.findActiveUserById(claims.sub);
    if (!user) {
      await this.dependencies.sessionStore.revokeSession(claims.sub, claims.sid);
      throw unauthenticated();
    }

    return { ...toAuthUserDto(user), sessionId: claims.sid };
  }

  async logout(accessToken: string | undefined): Promise<void> {
    if (!accessToken) return;
    const claims = await this.dependencies.tokenService.verifyAccessToken(accessToken);
    if (!claims) return;

    await this.dependencies.sessionStore.revokeSessionByAccessToken({
      userId: claims.sub,
      sessionId: claims.sid,
      accessTokenDigest: digestToken(accessToken),
    });
  }

  private async issueTokens(
    userId: string,
    sessionId: string,
    now: Date,
  ): Promise<{ sessionId: string; value: AuthTokens }> {
    const accessExpiresAt = addSeconds(now, this.dependencies.options.AUTH_ACCESS_TTL_SECONDS);
    const refreshExpiresAt = addSeconds(
      now,
      this.dependencies.options.AUTH_REFRESH_TOKEN_TTL_SECONDS,
    );
    const [accessToken, refreshToken] = await Promise.all([
      this.dependencies.tokenService.signAccessToken({
        userId,
        sessionId,
        issuedAt: now,
        expiresAt: accessExpiresAt,
      }),
      this.dependencies.tokenService.signRefreshToken({
        userId,
        sessionId,
        issuedAt: now,
        expiresAt: refreshExpiresAt,
      }),
    ]);

    return {
      sessionId,
      value: { accessToken, accessExpiresAt, refreshToken, refreshExpiresAt },
    };
  }
}
