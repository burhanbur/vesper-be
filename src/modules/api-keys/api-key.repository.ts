import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import type { ListApiKeysQuery } from './api-key.schema.js';
import type { ApiKeyRecord } from './api-key.types.js';

export type CreateApiKeyData = {
  id: string;
  name: string;
  key: string;
  description?: string | null;
  application?: string | null;
  ipWhitelist?: string[] | null;
  permissions?: string[] | null;
  rateLimit: number;
  expiresAt?: Date | null;
  createdBy?: string | null;
};

export type UpdateApiKeyData = {
  name?: string;
  description?: string | null;
  application?: string | null;
  ipWhitelist?: string[] | null;
  permissions?: string[] | null;
  isActive?: boolean;
  rateLimit?: number;
  expiresAt?: Date | null;
  updatedBy?: string | null;
};

export interface ApiKeyRepository {
  findByKey(key: string): Promise<ApiKeyRecord | null>;
  findById(id: string): Promise<ApiKeyRecord | null>;
  findMany(query: ListApiKeysQuery): Promise<{ items: ApiKeyRecord[]; total: number }>;
  create(data: CreateApiKeyData): Promise<ApiKeyRecord>;
  update(id: string, data: UpdateApiKeyData): Promise<ApiKeyRecord | null>;
  delete(id: string): Promise<boolean>;
  touchLastUsed(id: string, now: Date): Promise<void>;
}

export class PrismaApiKeyRepository implements ApiKeyRepository {
  constructor(private readonly client: PrismaClient) {}

  async findByKey(key: string): Promise<ApiKeyRecord | null> {
    return this.client.apiKey.findUnique({
      where: { key },
    });
  }

  async findById(id: string): Promise<ApiKeyRecord | null> {
    return this.client.apiKey.findUnique({
      where: { id },
    });
  }

  async findMany(query: ListApiKeysQuery): Promise<{ items: ApiKeyRecord[]; total: number }> {
    const where: Prisma.ApiKeyWhereInput = {
      ...(query.is_active !== undefined ? { isActive: query.is_active } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { application: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.client.$transaction([
      this.client.apiKey.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.client.apiKey.count({ where }),
    ]);

    return { items, total };
  }

  async create(data: CreateApiKeyData): Promise<ApiKeyRecord> {
    return this.client.apiKey.create({
      data: {
        id: data.id,
        name: data.name,
        key: data.key,
        description: data.description ?? null,
        application: data.application ?? null,
        ...(data.ipWhitelist
          ? { ipWhitelist: data.ipWhitelist as Prisma.InputJsonValue }
          : { ipWhitelist: Prisma.DbNull }),
        ...(data.permissions
          ? { permissions: data.permissions as Prisma.InputJsonValue }
          : { permissions: Prisma.DbNull }),
        rateLimit: data.rateLimit,
        expiresAt: data.expiresAt ?? null,
        createdBy: data.createdBy ?? null,
      },
    });
  }

  async update(id: string, data: UpdateApiKeyData): Promise<ApiKeyRecord | null> {
    try {
      return await this.client.apiKey.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.application !== undefined ? { application: data.application } : {}),
          ...(data.ipWhitelist !== undefined
            ? {
                ipWhitelist: data.ipWhitelist
                  ? (data.ipWhitelist as Prisma.InputJsonValue)
                  : Prisma.DbNull,
              }
            : {}),
          ...(data.permissions !== undefined
            ? {
                permissions: data.permissions
                  ? (data.permissions as Prisma.InputJsonValue)
                  : Prisma.DbNull,
              }
            : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
          ...(data.rateLimit !== undefined ? { rateLimit: data.rateLimit } : {}),
          ...(data.expiresAt !== undefined ? { expiresAt: data.expiresAt } : {}),
          ...(data.updatedBy !== undefined ? { updatedBy: data.updatedBy } : {}),
        },
      });
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.client.apiKey.delete({
        where: { id },
      });
      return true;
    } catch {
      return false;
    }
  }

  async touchLastUsed(id: string, now: Date): Promise<void> {
    await this.client.apiKey
      .update({
        where: { id },
        data: { lastUsedAt: now },
      })
      .catch(() => {
        // Ignored to avoid failing request on timestamp touch
      });
  }
}
