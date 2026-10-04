import crypto from 'node:crypto';
import { AppError } from '../../common/errors/app-error.js';
import type { Pagination } from '../../common/http/api-response.js';
import { generateId } from '../../common/utils/id.js';
import type { ApiKeyRepository, CreateApiKeyData, UpdateApiKeyData } from './api-key.repository.js';
import type { CreateApiKeyInput, ListApiKeysQuery, UpdateApiKeyInput } from './api-key.schema.js';
import {
  type ApiKeyCreatedDto,
  type ApiKeyDto,
  type ApiKeyPrincipal,
  toApiKeyCreatedDto,
  toApiKeyDto,
} from './api-key.types.js';

function normalizeIp(ip: string): string {
  if (ip.startsWith('::ffff:')) {
    return ip.slice(7);
  }
  return ip;
}

function isIpAllowed(clientIp: string, whitelist: unknown): boolean {
  if (!whitelist || !Array.isArray(whitelist) || whitelist.length === 0) {
    return true;
  }
  const normalizedClient = normalizeIp(clientIp.trim());
  return whitelist.some((entry) => {
    if (typeof entry !== 'string') return false;
    const normalizedEntry = normalizeIp(entry.trim());
    return normalizedClient === normalizedEntry;
  });
}

function parsePermissions(permissions: unknown): string[] {
  if (!Array.isArray(permissions)) return [];
  return permissions.filter((p): p is string => typeof p === 'string');
}

export class ApiKeyService {
  constructor(private readonly repository: ApiKeyRepository) {}

  async create(userId: string | null, input: CreateApiKeyInput): Promise<ApiKeyCreatedDto> {
    const expiresAt = input.expires_at ? new Date(input.expires_at) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new AppError({
        statusCode: 422,
        code: 'INVALID_EXPIRES_AT',
        message: 'Waktu kedaluwarsa harus di masa depan.',
      });
    }

    const key = crypto.randomBytes(32).toString('hex');
    const data: CreateApiKeyData = {
      id: generateId(),
      name: input.name,
      key,
      description: input.description ?? null,
      application: input.application ?? null,
      ipWhitelist: input.ip_whitelist ?? null,
      permissions: input.permissions ?? null,
      rateLimit: input.rate_limit,
      expiresAt,
      createdBy: userId,
    };

    const record = await this.repository.create(data);
    return toApiKeyCreatedDto(record);
  }

  async list(query: ListApiKeysQuery): Promise<{ items: ApiKeyDto[]; pagination: Pagination }> {
    const { items, total } = await this.repository.findMany(query);
    const from = total === 0 ? null : (query.page - 1) * query.limit + 1;
    const to = total === 0 ? null : Math.min(query.page * query.limit, total);

    return {
      items: items.map(toApiKeyDto),
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

  async getById(id: string): Promise<ApiKeyDto> {
    const record = await this.repository.findById(id);
    if (!record) {
      throw new AppError({
        statusCode: 404,
        code: 'API_KEY_NOT_FOUND',
        message: 'API Key tidak ditemukan.',
      });
    }
    return toApiKeyDto(record);
  }

  async update(id: string, userId: string | null, input: UpdateApiKeyInput): Promise<ApiKeyDto> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new AppError({
        statusCode: 404,
        code: 'API_KEY_NOT_FOUND',
        message: 'API Key tidak ditemukan.',
      });
    }

    const expiresAt =
      input.expires_at !== undefined
        ? input.expires_at
          ? new Date(input.expires_at)
          : null
        : undefined;

    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new AppError({
        statusCode: 422,
        code: 'INVALID_EXPIRES_AT',
        message: 'Waktu kedaluwarsa harus di masa depan.',
      });
    }

    const updateData: UpdateApiKeyData = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.application !== undefined ? { application: input.application } : {}),
      ...(input.ip_whitelist !== undefined ? { ipWhitelist: input.ip_whitelist } : {}),
      ...(input.permissions !== undefined ? { permissions: input.permissions } : {}),
      ...(input.is_active !== undefined ? { isActive: input.is_active } : {}),
      ...(input.rate_limit !== undefined ? { rateLimit: input.rate_limit } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      updatedBy: userId,
    };

    const updated = await this.repository.update(id, updateData);
    if (!updated) {
      throw new AppError({
        statusCode: 404,
        code: 'API_KEY_NOT_FOUND',
        message: 'API Key tidak ditemukan.',
      });
    }

    return toApiKeyDto(updated);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new AppError({
        statusCode: 404,
        code: 'API_KEY_NOT_FOUND',
        message: 'API Key tidak ditemukan.',
      });
    }
    await this.repository.delete(id);
  }

  async validateKey(rawKey: string, clientIp: string): Promise<ApiKeyPrincipal> {
    const record = await this.repository.findByKey(rawKey);
    if (!record) {
      throw new AppError({
        statusCode: 401,
        code: 'INVALID_API_KEY',
        message: 'API Key tidak valid.',
      });
    }

    if (!record.isActive) {
      throw new AppError({
        statusCode: 403,
        code: 'API_KEY_INACTIVE',
        message: 'API Key tidak aktif.',
      });
    }

    if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
      throw new AppError({
        statusCode: 403,
        code: 'API_KEY_EXPIRED',
        message: 'API Key telah kedaluwarsa.',
      });
    }

    if (!isIpAllowed(clientIp, record.ipWhitelist)) {
      throw new AppError({
        statusCode: 403,
        code: 'IP_NOT_WHITELISTED',
        message: 'Alamat IP tidak diizinkan untuk API Key ini.',
      });
    }

    // Touch last used timestamp asynchronously
    void this.repository.touchLastUsed(record.id, new Date());

    return {
      id: record.id,
      name: record.name,
      application: record.application,
      permissions: parsePermissions(record.permissions),
      rateLimit: record.rateLimit,
    };
  }
}
