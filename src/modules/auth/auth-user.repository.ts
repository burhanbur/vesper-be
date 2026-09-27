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

export interface AuthUserRepository {
  findLoginUser(identifier: string): Promise<AuthUserRecord | null>;
  findActiveUserById(userId: string): Promise<AuthUserRecord | null>;
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
}
