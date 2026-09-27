export type AppErrorOptions = {
  statusCode: number;
  code: string;
  message: string;
  errors?: unknown;
  cause?: unknown;
};

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly errors?: unknown;

  constructor(options: AppErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = 'AppError';
    this.statusCode = options.statusCode;
    this.code = options.code;
    if (options.errors !== undefined) {
      this.errors = options.errors;
    }
  }
}
