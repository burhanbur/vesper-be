import { generateId } from '../../common/utils/id.js';
import type { TransferRepository } from './transfer.repository.js';
import type { CreateTransferInput, TransferDto, UpdateTransferInput } from './transfer.schema.js';
import { toTransferDto } from './transfer.types.js';

export class TransferService {
  constructor(private readonly repository: TransferRepository) {}
  async create(userId: string, input: CreateTransferInput): Promise<TransferDto> {
    return toTransferDto(await this.repository.create(userId, generateId(), input));
  }
  async update(
    userId: string,
    id: string,
    version: string,
    input: Omit<UpdateTransferInput, 'version'>,
  ): Promise<TransferDto> {
    return toTransferDto(await this.repository.updateOffline(userId, id, version, input));
  }
  async delete(userId: string, id: string, version?: string): Promise<TransferDto> {
    return toTransferDto(await this.repository.deleteOffline(userId, id, version));
  }
}
