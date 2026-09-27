export type AuthUserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';

export type AuthUserRecord = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  status: AuthUserStatus;
  deletedAt: Date | null;
  roles: string[];
};

export type AuthUserDto = {
  id: string;
  name: string;
  email: string;
  status: AuthUserStatus;
  roles: string[];
};

export type AuthPrincipal = AuthUserDto & {
  sessionId: string;
};

export type AuthTokens = {
  accessToken: string;
  accessExpiresAt: Date;
  refreshToken: string;
  refreshExpiresAt: Date;
};

export type AuthResult = {
  user: AuthUserDto;
  tokens: AuthTokens;
};

export function toAuthUserDto(user: AuthUserRecord): AuthUserDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    status: user.status,
    roles: user.roles,
  };
}
