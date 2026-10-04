import { AppError } from '../../src/common/errors/app-error.js';
import type {
  AuthUserRepository,
  CreateAuthUserRecord,
} from '../../src/modules/auth/auth-user.repository.js';
import type { AuthUserRecord } from '../../src/modules/auth/auth.types.js';

type FakeAuthUserRecord = AuthUserRecord & { username?: string | undefined };

export class FakeAuthRepository implements AuthUserRepository {
  private readonly users = new Map<string, FakeAuthUserRecord>();

  addUser(user: FakeAuthUserRecord): void {
    this.users.set(user.email, user);
  }

  setUserRoles(userId: string, roles: string[]): void {
    const user = [...this.users.values()].find((candidate) => candidate.id === userId);
    if (!user) throw new Error('Fake auth user not found');
    user.roles = roles;
  }

  async findLoginUser(identifier: string): Promise<AuthUserRecord | null> {
    return (
      [...this.users.values()].find(
        (user) => user.email === identifier || user.username === identifier,
      ) ?? null
    );
  }

  async findActiveUserById(userId: string): Promise<AuthUserRecord | null> {
    const user = [...this.users.values()].find((candidate) => candidate.id === userId);
    return user?.status === 'ACTIVE' && !user.deletedAt ? user : null;
  }

  async createUser(data: CreateAuthUserRecord): Promise<AuthUserRecord> {
    const existingEmail = [...this.users.values()].find(
      (user) => user.email.toLowerCase() === data.email.toLowerCase(),
    );
    if (existingEmail) {
      throw new AppError({
        statusCode: 409,
        code: 'EMAIL_ALREADY_EXISTS',
        message: 'Email sudah terdaftar.',
      });
    }

    if (data.username) {
      const existingUsername = [...this.users.values()].find(
        (user) => user.username?.toLowerCase() === data.username!.toLowerCase(),
      );
      if (existingUsername) {
        throw new AppError({
          statusCode: 409,
          code: 'USERNAME_ALREADY_EXISTS',
          message: 'Username sudah digunakan.',
        });
      }
    }

    const record: FakeAuthUserRecord = {
      id: data.id,
      name: data.name,
      username: data.username ?? undefined,
      email: data.email,
      passwordHash: data.passwordHash,
      status: 'ACTIVE',
      deletedAt: null,
      roles: ['User'],
    };
    this.users.set(data.email, record);
    return record;
  }
}
