import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { CreateUserInput, ListUsersQuery, UpdateUserInput } from './user.schema.js';
import type { UserRecord } from './user.types.js';

const userSelection = {
  id: true,
  name: true,
  username: true,
  email: true,
  passwordHash: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export type CreateUserRecord = Omit<CreateUserInput, 'password' | 'username'> & {
  id: string;
  username?: string | null;
  passwordHash: string;
};

export type UpdateUserRecord = Omit<UpdateUserInput, 'password'> & {
  passwordHash?: string;
};

export type UserPage = {
  items: UserRecord[];
  total: number;
};

export interface UserRepository {
  findPage(query: ListUsersQuery): Promise<UserPage>;
  findExportBatch(input: { cursor?: string; limit: number }): Promise<UserRecord[]>;
  findById(id: string): Promise<UserRecord | null>;
  findExistingEmails(emails: string[]): Promise<string[]>;
  create(data: CreateUserRecord): Promise<UserRecord>;
  createMany(data: CreateUserRecord[]): Promise<void>;
  update(id: string, data: UpdateUserRecord): Promise<UserRecord>;
  softDelete(id: string): Promise<void>;
}

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly client: PrismaClient) {}

  async findPage(query: ListUsersQuery): Promise<UserPage> {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { username: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const sortField = query.sort === 'created_at' ? 'createdAt' : query.sort;

    const [items, total] = await this.client.$transaction([
      this.client.user.findMany({
        where,
        select: userSelection,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { [sortField]: query.order },
      }),
      this.client.user.count({ where }),
    ]);

    return { items, total };
  }

  async findExportBatch(input: { cursor?: string; limit: number }): Promise<UserRecord[]> {
    return this.client.user.findMany({
      where: { deletedAt: null },
      select: userSelection,
      take: input.limit,
      orderBy: { id: 'asc' },
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });
  }

  async findById(id: string): Promise<UserRecord | null> {
    return this.client.user.findFirst({
      where: { id, deletedAt: null },
      select: userSelection,
    });
  }

  async findExistingEmails(emails: string[]): Promise<string[]> {
    const users = await this.client.user.findMany({
      where: { email: { in: emails } },
      select: { email: true },
    });
    return users.map((user) => user.email);
  }

  async create(data: CreateUserRecord): Promise<UserRecord> {
    return this.client.user.create({
      data: { ...data, username: data.username ?? null },
      select: userSelection,
    });
  }

  async createMany(data: CreateUserRecord[]): Promise<void> {
    await this.client.$transaction(
      data.map((user) =>
        this.client.user.create({
          data: { ...user, username: user.username ?? null },
          select: { id: true },
        }),
      ),
    );
  }

  async update(id: string, data: UpdateUserRecord): Promise<UserRecord> {
    const updateData: Prisma.UserUpdateInput = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.username !== undefined) updateData.username = data.username;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.passwordHash !== undefined) updateData.passwordHash = data.passwordHash;

    return this.client.user.update({ where: { id }, data: updateData, select: userSelection });
  }

  async softDelete(id: string): Promise<void> {
    await this.client.user.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: { id: true },
    });
  }
}
