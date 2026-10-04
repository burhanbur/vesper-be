import { z } from '../../common/openapi/zod.js';

export const CategoryTypeSchema = z.enum(['INCOME', 'EXPENSE']);
export const CategoryVersionSchema = z
  .string()
  .regex(/^[1-9]\d{0,18}$/)
  .refine(
    (value) => /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n,
    'Versi di luar batas bigint.',
  )
  .describe('Positive PostgreSQL bigint version as a decimal string, never a JSON number.');
export const CreateCategorySchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  type: CategoryTypeSchema,
});
export const UpdateCategorySchema = z
  .strictObject({
    version: CategoryVersionSchema,
    name: z.string().trim().min(1).max(120).optional(),
    type: CategoryTypeSchema.optional(),
  })
  .refine((input) => input.name !== undefined || input.type !== undefined, {
    message: 'Minimal satu kolom perubahan wajib diisi.',
  });
export const CategoryIdParamsSchema = z.strictObject({ id: z.uuid() });
export const DeleteCategoryQuerySchema = z.strictObject({ version: CategoryVersionSchema });
export const ListCategoriesQuerySchema = z.strictObject({
  account_id: z
    .uuid()
    .optional()
    .describe(
      'Accessible account: returns its owner categories, never an arbitrary user selector.',
    ),
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['created_at', '-created_at', 'name', '-name']).default('-created_at'),
  name: z.string().trim().min(1).max(120).optional().describe('Case-insensitive name substring.'),
  type: CategoryTypeSchema.optional(),
});
export const CategoryDtoSchema = z.strictObject({
  id: z.uuid(),
  user_id: z.uuid(),
  name: z.string(),
  type: CategoryTypeSchema,
  version: CategoryVersionSchema,
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  deleted_at: z.iso.datetime().nullable(),
});
export type CreateCategoryInput = z.infer<typeof CreateCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof UpdateCategorySchema>;
export type ListCategoriesQuery = z.infer<typeof ListCategoriesQuerySchema>;
export type CategoryIdParams = z.infer<typeof CategoryIdParamsSchema>;
export type DeleteCategoryQuery = z.infer<typeof DeleteCategoryQuerySchema>;
export type CategoryDto = z.infer<typeof CategoryDtoSchema>;
