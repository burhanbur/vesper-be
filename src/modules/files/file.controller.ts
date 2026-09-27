import { pipeline } from 'node:stream/promises';
import type { RequestHandler } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import { sendSuccess } from '../../common/http/api-response.js';
import type { ValidatedInput } from '../../common/middleware/validate.js';
import type { ListFilesQuery } from './file.schema.js';
import type { FileService } from './file.service.js';
import { toFileDto } from './file.types.js';

type FileIdParams = { id: string };

function validated(responseLocals: Record<string, unknown>): ValidatedInput {
  return responseLocals.validated as ValidatedInput;
}

export function createFileController(service: FileService) {
  const list: RequestHandler = async (request, response) => {
    const query = validated(response.locals).query as ListFilesQuery;
    const result = await service.list(query);
    sendSuccess(request, response, {
      data: result.files,
      message: 'Data file berhasil diambil.',
      totalData: result.files.length,
      pagination: result.pagination,
    });
  };

  const show: RequestHandler = async (request, response) => {
    const { id } = validated(response.locals).params as FileIdParams;
    const file = await service.getById(id);
    sendSuccess(request, response, {
      data: toFileDto(file),
      message: 'Data file berhasil diambil.',
    });
  };

  const upload: RequestHandler = async (request, response) => {
    if (!request.file) {
      throw new AppError({
        statusCode: 422,
        code: 'UPLOAD_FILE_REQUIRED',
        message: 'File wajib diunggah.',
        errors: { file: ['Pilih satu file untuk diunggah.'] },
      });
    }
    const file = await service.upload(request.file);
    sendSuccess(request, response, {
      data: file,
      message: 'File berhasil diunggah.',
      statusCode: 201,
    });
  };

  const download: RequestHandler = async (_request, response) => {
    const { id } = validated(response.locals).params as FileIdParams;
    const { metadata, object } = await service.download(id);
    response.status(200);
    response.attachment(metadata.originalName);
    response.setHeader('Content-Type', metadata.mimeType);
    response.setHeader('Content-Length', object.size.toString());
    response.setHeader('X-Content-Type-Options', 'nosniff');
    await pipeline(object.body, response);
  };

  const remove: RequestHandler = async (request, response) => {
    const { id } = validated(response.locals).params as FileIdParams;
    await service.delete(id);
    sendSuccess(request, response, { data: null, message: 'File berhasil dihapus.' });
  };

  return { list, show, upload, download, remove };
}
