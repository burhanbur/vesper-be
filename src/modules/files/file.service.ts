import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { AppError } from '../../common/errors/app-error.js';
import type { Pagination } from '../../common/http/api-response.js';
import { generateId } from '../../common/utils/id.js';
import { config } from '../../config/index.js';
import type { FileStorage, StoredObject } from '../../infrastructure/storage/file-storage.js';
import type { FileRepository } from './file.repository.js';
import type { ListFilesQuery } from './file.schema.js';
import { toFileDto, type FileDto, type FileRecord } from './file.types.js';

const allowedMimeTypes = new Set(
  config.FILE_ALLOWED_MIME_TYPES.split(',')
    .map((mimeType) => mimeType.trim().toLowerCase())
    .filter(Boolean),
);

export type FileListResult = {
  files: FileDto[];
  pagination: Pagination;
};

export type DownloadedFile = {
  metadata: FileRecord;
  object: StoredObject;
};

function safeOriginalName(filename: string): string {
  const basename = [...path.basename(filename)]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 32 && codePoint !== 127;
    })
    .join('')
    .trim();
  return basename.slice(0, 255) || 'file';
}

export class FileService {
  constructor(
    private readonly repository: FileRepository,
    private readonly storage: FileStorage,
  ) {}

  async list(query: ListFilesQuery): Promise<FileListResult> {
    const { items, total } = await this.repository.findPage(query);
    const from = total === 0 ? null : (query.page - 1) * query.limit + 1;
    const to = total === 0 ? null : Math.min(query.page * query.limit, total);
    return {
      files: items.map(toFileDto),
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

  async getById(id: string): Promise<FileRecord> {
    const file = await this.repository.findById(id);
    if (!file) {
      throw new AppError({
        statusCode: 404,
        code: 'FILE_NOT_FOUND',
        message: 'File tidak ditemukan.',
      });
    }
    return file;
  }

  async upload(file: Express.Multer.File): Promise<FileDto> {
    const detected = await fileTypeFromBuffer(file.buffer);
    if (!detected || !allowedMimeTypes.has(detected.mime)) {
      throw new AppError({
        statusCode: 422,
        code: 'UNSUPPORTED_FILE_TYPE',
        message: 'Tipe file tidak diizinkan.',
        errors: {
          file: [`Tipe yang diizinkan: ${[...allowedMimeTypes].join(', ')}.`],
        },
      });
    }

    const suppliedExtension = path.extname(file.originalname).slice(1).toLowerCase();
    const compatibleExtensions =
      detected.ext === 'jpg' ? new Set(['jpg', 'jpeg']) : new Set([detected.ext]);
    if (!compatibleExtensions.has(suppliedExtension)) {
      throw new AppError({
        statusCode: 422,
        code: 'FILE_EXTENSION_MISMATCH',
        message: 'Ekstensi file tidak sesuai dengan isi file.',
        errors: { file: [`Gunakan ekstensi .${detected.ext}.`] },
      });
    }

    const id = generateId();
    const datePrefix = new Date().toISOString().slice(0, 7).replace('-', '/');
    const storageKey = `${datePrefix}/${id}.${detected.ext}`;
    const checksum = createHash('sha256').update(file.buffer).digest('hex');

    await this.storage.put(storageKey, file.buffer);
    try {
      const record = await this.repository.create({
        id,
        storageKey,
        originalName: safeOriginalName(file.originalname),
        mimeType: detected.mime,
        extension: detected.ext,
        size: BigInt(file.size),
        checksum,
      });
      return toFileDto(record);
    } catch (error) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
  }

  async download(id: string): Promise<DownloadedFile> {
    const metadata = await this.getById(id);
    const object = await this.storage.get(metadata.storageKey);
    return { metadata, object };
  }

  async delete(id: string): Promise<void> {
    const file = await this.getById(id);
    await this.repository.softDelete(id);
    await this.storage.delete(file.storageKey);
  }
}
