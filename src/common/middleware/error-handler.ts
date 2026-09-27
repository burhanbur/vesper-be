import type { ErrorRequestHandler } from 'express';
import multer from 'multer';
import { config } from '../../config/index.js';
import { Prisma } from '../../generated/prisma/client.js';
import { logger } from '../../infrastructure/logger.js';
import { AppError } from '../errors/app-error.js';
import { sendError } from '../http/api-response.js';

function productionMessage(statusCode: number, fallback: string): string {
  switch (statusCode) {
    case 400:
      return fallback || 'Permintaan tidak valid.';
    case 401:
      return 'Akses tidak sah. Silakan masuk untuk melanjutkan.';
    case 403:
      return 'Anda tidak memiliki izin untuk melakukan tindakan ini.';
    case 404:
      return 'Data yang diminta tidak ditemukan.';
    case 413:
      return 'Ukuran permintaan terlalu besar.';
    case 422:
      return fallback || 'Validasi gagal. Silakan periksa input Anda.';
    case 429:
      return 'Terlalu banyak permintaan. Silakan coba lagi nanti.';
    case 500:
    case 503:
      return 'Layanan sementara tidak tersedia. Silakan coba lagi nanti.';
    default:
      return 'Terjadi kesalahan saat memproses permintaan.';
  }
}

function parserErrorType(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('type' in error)) {
    return undefined;
  }

  return typeof error.type === 'string' ? error.type : undefined;
}

function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  const errorType = parserErrorType(error);
  if (error instanceof SyntaxError && errorType === 'entity.parse.failed') {
    return new AppError({
      statusCode: 400,
      code: 'MALFORMED_JSON',
      message: 'Format JSON tidak valid.',
      cause: error,
    });
  }

  if (errorType === 'entity.too.large') {
    return new AppError({
      statusCode: 413,
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Ukuran permintaan terlalu besar.',
      cause: error,
    });
  }

  if (error instanceof multer.MulterError) {
    const isSizeError = error.code === 'LIMIT_FILE_SIZE';
    return new AppError({
      statusCode: isSizeError ? 413 : 422,
      code: isSizeError ? 'UPLOAD_TOO_LARGE' : 'INVALID_MULTIPART_UPLOAD',
      message: isSizeError
        ? 'Ukuran file melebihi batas yang diizinkan.'
        : 'Permintaan upload tidak valid.',
      cause: error,
    });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new AppError({
      statusCode: 409,
      code: 'RESOURCE_CONFLICT',
      message: 'Data dengan nilai tersebut sudah terdaftar.',
      cause: error,
    });
  }

  return new AppError({
    statusCode: 500,
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Terjadi kesalahan internal pada server.',
    cause: error,
  });
}

export const errorHandler: ErrorRequestHandler = (error, request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  const normalized = normalizeError(error);

  logger[normalized.statusCode >= 500 ? 'error' : 'warn'](
    {
      err: error,
      code: normalized.code,
      statusCode: normalized.statusCode,
      requestId: request.id,
    },
    'API error response',
  );

  const message =
    config.NODE_ENV === 'production'
      ? productionMessage(normalized.statusCode, normalized.message)
      : normalized.message;

  sendError(request, response, {
    message,
    statusCode: normalized.statusCode,
    errors: normalized.errors,
    originalMessage: normalized.message,
  });
};
