import { z } from 'zod';

function booleanFromString(defaultValue: 'true' | 'false') {
  return z
    .enum(['true', 'false'])
    .default(defaultValue)
    .transform((value) => value === 'true');
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_NAME: z.string().min(1).default('express-starter-kit'),
    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    TRUST_PROXY: booleanFromString('false'),
    BODY_LIMIT_BYTES: z.coerce.number().int().positive().max(10_485_760).default(1_048_576),
    HTTP_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
    HTTP_HEADERS_TIMEOUT_MS: z.coerce.number().int().positive().default(16_000),
    HTTP_KEEP_ALIVE_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    EXCEL_IMPORT_MAX_BYTES: z.coerce.number().int().positive().default(5_242_880),
    EXCEL_IMPORT_MAX_ROWS: z.coerce.number().int().min(1).max(10_000).default(1_000),
    EXCEL_EXPORT_BATCH_SIZE: z.coerce.number().int().min(1).max(5_000).default(500),
    FILE_STORAGE_PATH: z.string().min(1).default('storage/uploads'),
    FILE_UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(10_485_760),
    FILE_ALLOWED_MIME_TYPES: z.string().min(1).default('application/pdf,image/jpeg,image/png'),
    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    CORS_ORIGINS: z.string().min(1),
    API_DOCS_ENABLED: booleanFromString('true'),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    AUTH_JWT_ISSUER: z.string().min(1).default('express-starter-kit'),
    AUTH_JWT_AUDIENCE: z.string().min(1).default('express-starter-kit-api'),
    AUTH_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600).default(900),
    AUTH_REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(300).default(604_800),
    AUTH_LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    AUTH_LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
    AUTH_REFRESH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    AUTH_REFRESH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  })
  .superRefine((value, context) => {
    if (value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) {
      context.addIssue({
        code: 'custom',
        path: ['JWT_REFRESH_SECRET'],
        message: 'must differ from JWT_ACCESS_SECRET',
      });
    }
  });

export type AppConfig = Readonly<
  Omit<z.infer<typeof envSchema>, 'CORS_ORIGINS'> & { corsOrigins: readonly string[] }
>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(environment);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
  }

  return {
    ...parsed.data,
    corsOrigins: parsed.data.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
}
