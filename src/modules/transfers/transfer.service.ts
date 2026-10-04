import { generateId } from '../../common/utils/id.js';
import type { TransferRepository } from './transfer.repository.js';
import type { CreateTransferInput, TransferDto } from './transfer.schema.js';
import { toTransferDto } from './transfer.types.js';

export class TransferService {
  constructor(private readonly repository: TransferRepository) {}
  async create(userId: string, input: CreateTransferInput): Promise<TransferDto> {
    return toTransferDto(await this.repository.create(userId, generateId(), input));
  }
}
