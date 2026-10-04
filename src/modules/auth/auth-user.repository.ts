import { AppError } from '../../common/errors/app-error.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { AuthUserRecord } from './auth.types.js';

const authUserSelection = {
  id: true,
  name: true,
  email: true,
  passwordHash: true,
  status: true,
  deletedAt: true,
  userRoles: {
    where: { role: { deletedAt: null } },
    select: { role: { select: { name: true } } },
    orderBy: { role: { name: 'asc' } },
  },
} satisfies Prisma.UserSelect;

type AuthUserRow = Prisma.UserGetPayload<{ select: typeof authUserSelection }>;

export type CreateAuthUserRecord = {
  id: string;
  name: string;
  username?: string | null;
  email: string;
  passwordHash: string;
};

export interface AuthUserRepository {
  findLoginUser(identifier: string): Promise<AuthUserRecord | null>;
  findActiveUserById(userId: string): Promise<AuthUserRecord | null>;
  createUser(data: CreateAuthUserRecord): Promise<AuthUserRecord>;
}

function toUser(row: AuthUserRow): AuthUserRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.passwordHash,
    status: row.status,
    deletedAt: row.deletedAt,
    roles: row.userRoles.map(({ role }) => role.name),
  };
}

export class PrismaAuthUserRepository implements AuthUserRepository {
  constructor(private readonly client: PrismaClient) {}

  async findLoginUser(identifier: string): Promise<AuthUserRecord | null> {
    const row = await this.client.user.findFirst({
      where: {
        OR: [
          { email: { equals: identifier, mode: 'insensitive' } },
          { username: { equals: identifier, mode: 'insensitive' } },
        ],
      },
      select: authUserSelection,
    });
    return row ? toUser(row) : null;
  }

  async findActiveUserById(userId: string): Promise<AuthUserRecord | null> {
    const row = await this.client.user.findFirst({
      where: { id: userId, status: 'ACTIVE', deletedAt: null },
      select: authUserSelection,
    });
    return row ? toUser(row) : null;
  }

  async createUser(data: CreateAuthUserRecord): Promise<AuthUserRecord> {
    const existing = await this.client.user.findFirst({
      where: {
        OR: [
          { email: { equals: data.email, mode: 'insensitive' } },
          ...(data.username
            ? [{ username: { equals: data.username, mode: 'insensitive' as const } }]
            : []),
        ],
      },
      select: { email: true, username: true },
    });

    if (existing) {
      if (existing.email.toLowerCase() === data.email.toLowerCase()) {
        throw new AppError({
          statusCode: 409,
          code: 'EMAIL_ALREADY_EXISTS',
          message: 'Email sudah terdaftar.',
        });
      }
      if (data.username && existing.username?.toLowerCase() === data.username.toLowerCase()) {
        throw new AppError({
          statusCode: 409,
          code: 'USERNAME_ALREADY_EXISTS',
          message: 'Username sudah digunakan.',
        });
      }
    }

    const defaultRole = await this.client.role.findFirst({
      where: {
        deletedAt: null,
        OR: [{ code: 'USR' }, { name: 'User' }],
      },
      select: { id: true },
    });

    const row = await this.client.user.create({
      data: {
        id: data.id,
        name: data.name,
        username: data.username ?? null,
        email: data.email,
        passwordHash: data.passwordHash,
        status: 'ACTIVE',
        ...(defaultRole
          ? {
              userRoles: {
                create: {
                  roleId: defaultRole.id,
                },
              },
            }
          : {}),
      },
      select: authUserSelection,
    });

    return toUser(row);
  }
}
