import { z } from '../../common/openapi/zod.js';

const name = z.string().trim().min(1).max(120);
export const GroupParamsSchema = z.strictObject({ id: z.uuid() });
export const GroupCategoryParamsSchema = z.strictObject({ id: z.uuid(), gcId: z.uuid() });
export const GroupPageSchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const CreateGroupSchema = z.strictObject({ name });
export const JoinGroupSchema = z.strictObject({ code: z.string().regex(/^[A-Z0-9]{12}$/) });
export const GroupAccountSchema = z.strictObject({ account_id: z.uuid() });
export const GroupMappingSchema = z.strictObject({ user_category_id: z.uuid() });
export const CreateGroupCategorySchema = z.strictObject({
  name,
  type: z.enum(['INCOME', 'EXPENSE']),
});
export const UpdateGroupCategorySchema = CreateGroupCategorySchema.partial().refine(
  (v) => v.name !== undefined || v.type !== undefined,
  'Minimal satu kolom wajib diisi.',
);
export const ManageGroupCategorySchema = z.strictObject({ group_category_id: z.uuid() });
export const PatchGroupCategorySchema = z
  .strictObject({
    group_category_id: z.uuid(),
    name: name.optional(),
    type: z.enum(['INCOME', 'EXPENSE']).optional(),
  })
  .refine((v) => v.name !== undefined || v.type !== undefined, 'Minimal satu kolom wajib diisi.');
export const GroupReportQuerySchema = z.strictObject({
  period: z
    .string()
    .regex(/^(?:[1-9]\d{3})-(?:0[1-9]|1[0-2])$/)
    .describe('UTC calendar month YYYY-MM; independent of budget anchors.'),
});
export const GroupDtoSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  is_active: z.boolean(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  role: z.enum(['OWNER', 'MEMBER']),
});
export const CreatedGroupDtoSchema = GroupDtoSchema.extend({ code: z.string() });
export const GroupMemberDtoSchema = z.strictObject({
  user_id: z.uuid(),
  role: z.enum(['OWNER', 'MEMBER']),
  name: z.string(),
  profile: z
    .strictObject({ full_name: z.string().nullable(), photo: z.string().nullable() })
    .nullable(),
  created_at: z.iso.datetime(),
});
export const GroupCategoryDtoSchema = z.strictObject({
  id: z.uuid(),
  group_id: z.uuid(),
  name: z.string(),
  type: z.enum(['INCOME', 'EXPENSE']),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export const GroupReportDtoSchema = z.strictObject({
  period: z.string(),
  categories: z.array(
    z.strictObject({
      group_category_id: z.uuid(),
      name: z.string(),
      type: z.enum(['INCOME', 'EXPENSE']),
      income: z.string(),
      expense: z.string(),
    }),
  ),
});
export type GroupPage = z.infer<typeof GroupPageSchema>;
export type GroupCategoryInput = z.infer<typeof CreateGroupCategorySchema>;
export type GroupCategoryPatch = z.infer<typeof UpdateGroupCategorySchema>;
export type GroupDto = z.infer<typeof GroupDtoSchema>;
export type GroupMemberDto = z.infer<typeof GroupMemberDtoSchema>;
export type GroupCategoryDto = z.infer<typeof GroupCategoryDtoSchema>;
export type GroupReportDto = z.infer<typeof GroupReportDtoSchema>;
