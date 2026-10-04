import type { z } from '../../common/openapi/zod.js';
import type { PullResponseSchema, PushResponseSchema } from './sync.schema.js';

export type PullResponse = z.infer<typeof PullResponseSchema>;
export type PushResponse = z.infer<typeof PushResponseSchema>;
