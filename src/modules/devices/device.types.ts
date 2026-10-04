import type { Device } from '../../generated/prisma/client.js';
import { DeviceDtoSchema, type DeviceDto } from './device.schema.js';

export type DeviceRecord = Device;

export function toDeviceDto(device: DeviceRecord): DeviceDto {
  return DeviceDtoSchema.parse({
    id: device.id,
    user_id: device.userId,
    name: device.name,
    platform: device.platform,
    app_version: device.appVersion,
    last_sync_version: device.lastSyncVersion.toString(),
    last_sync_at: device.lastSyncAt?.toISOString() ?? null,
    last_seen_at: device.lastSeenAt?.toISOString() ?? null,
    created_at: device.createdAt.toISOString(),
    updated_at: device.updatedAt.toISOString(),
  });
}
