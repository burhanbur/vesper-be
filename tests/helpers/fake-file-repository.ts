import type { CreateFileRecord, FileRepository } from '../../src/modules/files/file.repository.js';
import type { ListFilesQuery } from '../../src/modules/files/file.schema.js';
import type { FileRecord } from '../../src/modules/files/file.types.js';

export class FakeFileRepository implements FileRepository {
  private readonly files = new Map<string, FileRecord>();

  async create(data: CreateFileRecord): Promise<FileRecord> {
    const now = new Date();
    const record: FileRecord = { ...data, createdAt: now, updatedAt: now };
    this.files.set(record.id, record);
    return record;
  }

  async findById(id: string): Promise<FileRecord | null> {
    return this.files.get(id) ?? null;
  }

  async findPage(query: ListFilesQuery): Promise<{ items: FileRecord[]; total: number }> {
    const filtered = [...this.files.values()].filter(
      (file) =>
        !query.search || file.originalName.toLowerCase().includes(query.search.toLowerCase()),
    );
    const start = (query.page - 1) * query.limit;
    return { items: filtered.slice(start, start + query.limit), total: filtered.length };
  }

  async softDelete(id: string): Promise<void> {
    this.files.delete(id);
  }
}
