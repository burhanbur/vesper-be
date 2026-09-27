import type {
  CreateUserRecord,
  UpdateUserRecord,
  UserPage,
  UserRepository,
} from '../../src/modules/users/user.repository.js';
import type { ListUsersQuery } from '../../src/modules/users/user.schema.js';
import type { UserRecord } from '../../src/modules/users/user.types.js';

export class FakeUserRepository implements UserRepository {
  private readonly users = new Map<string, UserRecord>();

  async findPage(query: ListUsersQuery): Promise<UserPage> {
    const filtered = [...this.users.values()].filter((user) => {
      const matchesStatus = !query.status || user.status === query.status;
      const needle = query.search?.toLowerCase();
      const matchesSearch =
        !needle ||
        user.name.toLowerCase().includes(needle) ||
        (user.username?.toLowerCase().includes(needle) ?? false) ||
        user.email.toLowerCase().includes(needle);
      return matchesStatus && matchesSearch;
    });
    const start = (query.page - 1) * query.limit;
    return { items: filtered.slice(start, start + query.limit), total: filtered.length };
  }

  async findExportBatch(input: { cursor?: string; limit: number }): Promise<UserRecord[]> {
    const users = [...this.users.values()].sort((left, right) => left.id.localeCompare(right.id));
    const start = input.cursor
      ? Math.max(users.findIndex((user) => user.id === input.cursor) + 1, 0)
      : 0;
    return users.slice(start, start + input.limit);
  }

  async findById(id: string): Promise<UserRecord | null> {
    return this.users.get(id) ?? null;
  }

  async findExistingEmails(emails: string[]): Promise<string[]> {
    const candidates = new Set(emails);
    return [...this.users.values()]
      .filter((user) => candidates.has(user.email))
      .map((user) => user.email);
  }

  async create(data: CreateUserRecord): Promise<UserRecord> {
    if ([...this.users.values()].some((user) => user.email === data.email)) {
      throw new Error('Duplicate email');
    }
    const now = new Date();
    const record: UserRecord = {
      ...data,
      username: data.username ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.users.set(record.id, record);
    return record;
  }

  async createMany(data: CreateUserRecord[]): Promise<void> {
    if (
      data.some((candidate) =>
        [...this.users.values()].some((user) => user.email === candidate.email),
      )
    ) {
      throw new Error('Duplicate email');
    }
    for (const candidate of data) {
      await this.create(candidate);
    }
  }

  async update(id: string, data: UpdateUserRecord): Promise<UserRecord> {
    const current = this.users.get(id);
    if (!current) throw new Error('User not found');

    const updated: UserRecord = {
      ...current,
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.username !== undefined ? { username: data.username } : {}),
      ...(data.email !== undefined ? { email: data.email } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.passwordHash !== undefined ? { passwordHash: data.passwordHash } : {}),
      updatedAt: new Date(),
    };
    this.users.set(id, updated);
    return updated;
  }

  async softDelete(id: string): Promise<void> {
    this.users.delete(id);
  }
}
