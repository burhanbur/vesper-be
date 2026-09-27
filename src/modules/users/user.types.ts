import type { UserStatus } from '../../generated/prisma/client.js';

export type UserRecord = {
  id: string;
  name: string;
  username: string | null;
  email: string;
  passwordHash: string;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type UserDto = {
  id: string;
  name: string;
  username: string | null;
  email: string;
  status: UserStatus;
  created_at: string;
  updated_at: string;
};

export function toUserDto(user: UserRecord): UserDto {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    status: user.status,
    created_at: user.createdAt.toISOString(),
    updated_at: user.updatedAt.toISOString(),
  };
}
