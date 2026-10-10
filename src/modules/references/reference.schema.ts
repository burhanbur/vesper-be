import { z } from '../../common/openapi/zod.js';
import { CategoryTypeSchema } from '../categories/category.schema.js';

export const ListRefAccountTypesQuerySchema = z.strictObject({
    page: z.coerce.number().int().min(1).max(1000000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    sort: z.enum(['created_at', '-created_at', 'name', '-name']).default('-created_at'),
    name: z.string().trim().min(1).max(120).optional().describe('Case-insensitive name substring.'),
});
export const ListRefCategoriesQuerySchema = ListRefAccountTypesQuerySchema.extend({
    type: CategoryTypeSchema.optional(),
});
export const RefAccountTypeDtoSchema = z.strictObject({
    id: z.uuid(),
    name: z.string(),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
});
export const RefCategoryDtoSchema = RefAccountTypeDtoSchema.extend({ type: CategoryTypeSchema });

export type ListRefAccountTypesQuery = z.infer<typeof ListRefAccountTypesQuerySchema>;
export type ListRefCategoriesQuery = z.infer<typeof ListRefCategoriesQuerySchema>;
export type RefAccountTypeDto = z.infer<typeof RefAccountTypeDtoSchema>;
export type RefCategoryDto = z.infer<typeof RefCategoryDtoSchema>;
