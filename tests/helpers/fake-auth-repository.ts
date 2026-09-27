import type { AuthUserRepository } from '../../src/modules/auth/auth-user.repository.js';
import type { AuthUserRecord } from '../../src/modules/auth/auth.types.js';

type FakeAuthUserRecord = AuthUserRecord & { username?: string };

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
}
