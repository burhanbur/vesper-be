import type { Request, Response } from 'express';
import { config } from '../../config/index.js';
import { toDateTimeString } from '../utils/date.js';

export type Pagination = {
  total: number;
  per_page: number;
  current_page: number;
  last_page: number;
  from: number | null;
  to: number | null;
};

export type PaginatedData<T> = {
  items: T[];
  pagination: Pagination;
};

type SuccessOptions<T> = {
  data: T;
  message?: string | null;
  statusCode?: number;
  pagination?: Pagination;
  totalData?: number;
};

type ErrorOptions = {
  message: string;
  statusCode?: number;
  errors?: unknown;
  originalMessage?: unknown;
};

function requestUrl(request: Request): string {
  return `${request.protocol}://${request.get('host') ?? 'localhost'}${request.path}`;
}

function resolveTotalData(data: unknown): number {
  if (data === null || data === undefined) {
    return 0;
  }

  if (Array.isArray(data)) {
    return data.length;
  }

  if (typeof data === 'object' && 'data' in data) {
    const nestedData = (data as { data?: unknown }).data;
    if (Array.isArray(nestedData)) {
      return nestedData.length;
    }
  }

  return 1;
}

export function sendSuccess<T>(
  request: Request,
  response: Response,
  options: SuccessOptions<T>,
): Response {
  const payload: Record<string, unknown> = {
    success: true,
    message: options.message ?? null,
    timestamp: toDateTimeString(),
    total_data: options.totalData ?? resolveTotalData(options.data),
    data: options.data,
  };

  if (options.pagination) {
    payload.pagination = options.pagination;
  }

  if (config.NODE_ENV !== 'production') {
    payload.debug = {
      url: requestUrl(request),
      method: request.method,
    };
  }

  return response.status(options.statusCode ?? 200).json(payload);
}

export function sendError(request: Request, response: Response, options: ErrorOptions): Response {
  const payload: Record<string, unknown> = {
    success: false,
    message: options.message,
    timestamp: toDateTimeString(),
  };

  if (options.errors !== undefined && options.errors !== null) {
    payload.errors = options.errors;
  }

  if (config.NODE_ENV !== 'production') {
    payload.debug = {
      url: requestUrl(request),
      method: request.method,
      original_message: options.originalMessage ?? options.message,
    };
  }

  return response.status(options.statusCode ?? 400).json(payload);
}
