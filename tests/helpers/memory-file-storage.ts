import { Readable } from 'node:stream';
import type { FileStorage, StoredObject } from '../../src/infrastructure/storage/file-storage.js';

export class MemoryFileStorage implements FileStorage {
  private readonly objects = new Map<string, Buffer>();

  async put(key: string, body: Buffer): Promise<void> {
    this.objects.set(key, Buffer.from(body));
  }

  async get(key: string): Promise<StoredObject> {
    const body = this.objects.get(key);
    if (!body) throw new Error('Object not found');
    return { body: Readable.from(body), size: body.byteLength };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}
