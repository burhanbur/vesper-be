import { z } from '../../common/openapi/zod.js';

export const UserStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']);

export const UserIdParamsSchema = z.strictObject({
  id: z.uuid(),
});

export const CreateUserSchema = z.strictObject({
  name: z.string().trim().min(2).max(120),
  username: z.string().trim().min(3).max(64).toLowerCase().optional(),
  email: z.email().trim().toLowerCase(),
  password: z.string().min(8).max(128),
  status: UserStatusSchema.optional().default('ACTIVE'),
});

export const UpdateUserSchema = z
  .strictObject({
    name: z.string().trim().min(2).max(120).optional(),
    username: z.string().trim().min(3).max(64).toLowerCase().nullable().optional(),
    email: z.email().trim().toLowerCase().optional(),
    password: z.string().min(8).max(128).optional(),
    status: UserStatusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Minimal satu field harus diisi.',
  });

export const ListUsersQuerySchema = z.strictObject({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['name', 'email', 'created_at']).default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
  status: UserStatusSchema.optional(),
  search: z.string().trim().min(1).max(120).optional(),
});

export const UserDtoSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  username: z.string().nullable(),
  email: z.email(),
  status: UserStatusSchema,
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

export type CreateUserInput = z.infer<typeof CreateUserSchema>;
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;
