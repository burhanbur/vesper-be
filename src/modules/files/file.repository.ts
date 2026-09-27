import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { ListFilesQuery } from './file.schema.js';
import type { FileRecord } from './file.types.js';

const fileSelection = {
  id: true,
  storageKey: true,
  originalName: true,
  mimeType: true,
  extension: true,
  size: true,
  checksum: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.StoredFileSelect;

export type CreateFileRecord = {
  id: string;
  storageKey: string;
  originalName: string;
  mimeType: string;
  extension: string;
  size: bigint;
  checksum: string;
};

export interface FileRepository {
  create(data: CreateFileRecord): Promise<FileRecord>;
  findById(id: string): Promise<FileRecord | null>;
  findPage(query: ListFilesQuery): Promise<{ items: FileRecord[]; total: number }>;
  softDelete(id: string): Promise<void>;
}

export class PrismaFileRepository implements FileRepository {
  constructor(private readonly client: PrismaClient) {}

  async create(data: CreateFileRecord): Promise<FileRecord> {
    return this.client.storedFile.create({ data, select: fileSelection });
  }

  async findById(id: string): Promise<FileRecord | null> {
    return this.client.storedFile.findFirst({
      where: { id, deletedAt: null },
      select: fileSelection,
    });
  }

  async findPage(query: ListFilesQuery): Promise<{ items: FileRecord[]; total: number }> {
    const where: Prisma.StoredFileWhereInput = {
      deletedAt: null,
      ...(query.search ? { originalName: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.client.$transaction([
      this.client.storedFile.findMany({
        where,
        select: fileSelection,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.client.storedFile.count({ where }),
    ]);
    return { items, total };
  }

  async softDelete(id: string): Promise<void> {
    await this.client.storedFile.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: { id: true },
    });
  }
}
