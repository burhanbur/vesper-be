import type { PaginatedData } from '../../common/http/api-response.js';
import { generateId } from '../../common/utils/id.js';
import type { DeviceRepository } from './device.repository.js';
import type { DeviceDto, ListDevicesQuery, RegisterDeviceInput } from './device.schema.js';
import { toDeviceDto } from './device.types.js';

export class DeviceService {
  constructor(private readonly repository: DeviceRepository) {}

  async list(userId: string, query: ListDevicesQuery): Promise<PaginatedData<DeviceDto>> {
    const { items, total } = await this.repository.list(userId, query);
    const offset = (query.page - 1) * query.limit;
    return {
      items: items.map(toDeviceDto),
      pagination: {
        total,
        per_page: query.limit,
        current_page: query.page,
        last_page: Math.max(1, Math.ceil(total / query.limit)),
        from: items.length ? offset + 1 : null,
        to: items.length ? offset + items.length : null,
      },
    };
  }

  async register(userId: string, input: RegisterDeviceInput) {
    const result = await this.repository.register(userId, input.id ?? generateId(), input);
    return { device: toDeviceDto(result.device), created: result.created };
  }
}
