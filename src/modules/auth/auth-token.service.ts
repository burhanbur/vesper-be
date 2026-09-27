import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import { generateId } from '../../common/utils/id.js';

const TokenClaimsSchema = z.object({
  sub: z.uuid(),
  sid: z.uuid(),
  jti: z.uuid(),
  token_use: z.enum(['access', 'refresh']),
});
const AccessClaimsSchema = TokenClaimsSchema.extend({ token_use: z.literal('access') });
const RefreshClaimsSchema = TokenClaimsSchema.extend({ token_use: z.literal('refresh') });

export type TokenClaims = z.infer<typeof TokenClaimsSchema>;
export type AccessClaims = z.infer<typeof AccessClaimsSchema>;
export type RefreshClaims = z.infer<typeof RefreshClaimsSchema>;

export type AuthTokenServiceOptions = {
  accessSecret: string;
  refreshSecret: string;
  issuer: string;
  audience: string;
  now?: () => Date;
};

type SignTokenInput = {
  userId: string;
  sessionId: string;
  issuedAt: Date;
  expiresAt: Date;
};

export class AuthTokenService {
  private readonly accessKey: Uint8Array;
  private readonly refreshKey: Uint8Array;

  constructor(private readonly options: AuthTokenServiceOptions) {
    this.accessKey = new TextEncoder().encode(options.accessSecret);
    this.refreshKey = new TextEncoder().encode(options.refreshSecret);
  }

  signAccessToken(input: SignTokenInput): Promise<string> {
    return this.signToken(input, 'access', this.accessKey);
  }

  signRefreshToken(input: SignTokenInput): Promise<string> {
    return this.signToken(input, 'refresh', this.refreshKey);
  }

  verifyAccessToken(token: string): Promise<AccessClaims | null> {
    return this.verifyToken(token, this.accessKey, AccessClaimsSchema);
  }

  verifyRefreshToken(token: string): Promise<RefreshClaims | null> {
    return this.verifyToken(token, this.refreshKey, RefreshClaimsSchema);
  }

  private signToken(
    input: SignTokenInput,
    tokenUse: TokenClaims['token_use'],
    key: Uint8Array,
  ): Promise<string> {
    return new SignJWT({ sid: input.sessionId, token_use: tokenUse })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(this.options.issuer)
      .setAudience(this.options.audience)
      .setSubject(input.userId)
      .setJti(generateId())
      .setIssuedAt(Math.floor(input.issuedAt.getTime() / 1_000))
      .setExpirationTime(Math.floor(input.expiresAt.getTime() / 1_000))
      .sign(key);
  }

  private async verifyToken<T extends TokenClaims>(
    token: string,
    key: Uint8Array,
    claimsSchema: z.ZodType<T>,
  ): Promise<T | null> {
    try {
      const { payload, protectedHeader } = await jwtVerify(token, key, {
        algorithms: ['HS256'],
        issuer: this.options.issuer,
        audience: this.options.audience,
        typ: 'JWT',
        ...(this.options.now ? { currentDate: this.options.now() } : {}),
      });
      if (protectedHeader.alg !== 'HS256' || protectedHeader.typ !== 'JWT') return null;

      const parsed = claimsSchema.safeParse(payload);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
}
