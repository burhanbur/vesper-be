import type { ApiKey } from '../../generated/prisma/client.js';
import {
  type ApiKeyCreatedDto,
  ApiKeyCreatedDtoSchema,
  type ApiKeyDto,
  ApiKeyDtoSchema,
} from './api-key.schema.js';

export type { ApiKeyCreatedDto, ApiKeyDto };
export type ApiKeyRecord = ApiKey;

export type ApiKeyPrincipal = {
  id: string;
  name: string;
  application: string | null;
  permissions: string[];
  rateLimit: number;
};

function formatPrefix(key: string): string {
  if (key.length <= 12) return key;
  return `${key.slice(0, 8)}...${key.slice(-4)}`;
}

function parseJsonArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === 'string');
}

export function toApiKeyDto(record: ApiKeyRecord): ApiKeyDto {
  return ApiKeyDtoSchema.parse({
    id: record.id,
    name: record.name,
    description: record.description,
    application: record.application,
    key_prefix: formatPrefix(record.key),
    ip_whitelist: parseJsonArray(record.ipWhitelist),
    permissions: parseJsonArray(record.permissions),
    is_active: record.isActive,
    rate_limit: record.rateLimit,
    last_used_at: record.lastUsedAt?.toISOString() ?? null,
    expires_at: record.expiresAt?.toISOString() ?? null,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  });
}

export function toApiKeyCreatedDto(record: ApiKeyRecord): ApiKeyCreatedDto {
  return ApiKeyCreatedDtoSchema.parse({
    ...toApiKeyDto(record),
    key: record.key,
  });
}
