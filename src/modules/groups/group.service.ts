import { randomBytes } from 'node:crypto';
import { AppError } from '../../common/errors/app-error.js';
import { isGroupCodeCollision, type GroupRepository } from './group.repository.js';
import type { GroupPage, GroupCategoryInput, GroupCategoryPatch } from './group.schema.js';

function paginate<T>(result: { items: T[]; total: number }, page: GroupPage) {
  const offset = (page.page - 1) * page.limit;
  return {
    items: result.items,
    pagination: {
      total: result.total,
      per_page: page.limit,
      current_page: page.page,
      last_page: Math.max(1, Math.ceil(result.total / page.limit)),
      from: result.items.length ? offset + 1 : null,
      to: result.items.length ? offset + result.items.length : null,
    },
  };
}
export class GroupService {
  constructor(private readonly repository: GroupRepository) {}
  async create(userId: string, name: string) {
    for (let attempt = 0; attempt < 5; attempt++) {
      // 48 bits cryptographic entropy, uppercase short alphanumeric, no modulo bias.
      const code = randomBytes(6).toString('hex').toUpperCase();
      try {
        return await this.repository.create(userId, name, code);
      } catch (error) {
        if (!isGroupCodeCollision(error)) throw error;
      }
    }
    throw new AppError({
      statusCode: 409,
      code: 'GROUP_CODE_UNAVAILABLE',
      message: 'Grup belum dapat dibuat. Silakan coba lagi.',
    });
  }
  join(userId: string, id: string, code: string) {
    return this.repository.join(userId, id, code);
  }
  async list(userId: string, page: GroupPage) {
    return paginate(await this.repository.list(userId, page), page);
  }
  async members(userId: string, id: string, page: GroupPage) {
    return paginate(await this.repository.members(userId, id, page), page);
  }
  share(userId: string, id: string, accountId: string, remove: boolean) {
    return this.repository.share(userId, id, accountId, remove);
  }
  async categories(userId: string, id: string, page: GroupPage) {
    return paginate(await this.repository.categories(userId, id, page), page);
  }
  createCategory(userId: string, id: string, input: GroupCategoryInput) {
    return this.repository.createCategory(userId, id, input);
  }
  changeCategory(userId: string, id: string, categoryId: string, input?: GroupCategoryPatch) {
    return this.repository.changeCategory(userId, id, categoryId, input);
  }
  mapping(userId: string, id: string, categoryId: string, personalId: string, remove: boolean) {
    return this.repository.mapping(userId, id, categoryId, personalId, remove);
  }
  report(userId: string, id: string, period: string) {
    return this.repository.report(userId, id, period);
  }
}
