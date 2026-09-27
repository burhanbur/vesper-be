import argon2 from 'argon2';
import { AppError } from '../../common/errors/app-error.js';
import type { Pagination } from '../../common/http/api-response.js';
import { generateId } from '../../common/utils/id.js';
import type { CreateUserInput, ListUsersQuery, UpdateUserInput } from './user.schema.js';
import type { UpdateUserRecord, UserRepository } from './user.repository.js';
import { toUserDto, type UserDto } from './user.types.js';

export type UserListResult = {
  users: UserDto[];
  pagination: Pagination;
};

export class UserService {
  constructor(private readonly repository: UserRepository) {}

  async list(query: ListUsersQuery): Promise<UserListResult> {
    const { items, total } = await this.repository.findPage(query);
    const from = total === 0 ? null : (query.page - 1) * query.limit + 1;
    const to = total === 0 ? null : Math.min(query.page * query.limit, total);

    return {
      users: items.map(toUserDto),
      pagination: {
        total,
        per_page: query.limit,
        current_page: query.page,
        last_page: Math.ceil(total / query.limit),
        from,
        to,
      },
    };
  }

  async getById(id: string): Promise<UserDto> {
    const user = await this.repository.findById(id);
    if (!user) {
      throw new AppError({
        statusCode: 404,
        code: 'USER_NOT_FOUND',
        message: 'Pengguna tidak ditemukan.',
      });
    }
    return toUserDto(user);
  }

  async create(input: CreateUserInput): Promise<UserDto> {
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const user = await this.repository.create({
      id: generateId(),
      name: input.name,
      ...(input.username !== undefined ? { username: input.username } : {}),
      email: input.email,
      status: input.status,
      passwordHash,
    });
    return toUserDto(user);
  }

  async update(id: string, input: UpdateUserInput): Promise<UserDto> {
    await this.getById(id);
    const data: UpdateUserRecord = {};

    if (input.name !== undefined) data.name = input.name;
    if (input.username !== undefined) data.username = input.username;
    if (input.email !== undefined) data.email = input.email;
    if (input.status !== undefined) data.status = input.status;
    if (input.password !== undefined) {
      data.passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    }

    return toUserDto(await this.repository.update(id, data));
  }

  async delete(id: string): Promise<void> {
    await this.getById(id);
    await this.repository.softDelete(id);
  }
}
