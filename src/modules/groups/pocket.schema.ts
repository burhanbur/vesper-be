import { z } from '../../common/openapi/zod.js';

export const PocketGroupParamsSchema = z.object({ groupId: z.uuid() }).strict();
export const PocketParamsSchema = PocketGroupParamsSchema.extend({ pocketId: z.uuid() });
export const CreatePocketSchema = z.object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).optional(),
}).strict();
export const UpdatePocketSchema = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
}).strict().refine((data) => data.name !== undefined || data.description !== undefined, {
    message: 'Minimal satu bidang harus diperbarui.',
});
export const PocketAccountInputSchema = z.object({ account_id: z.uuid() }).strict();
const MoneySchema = z.string().regex(/^-?\d+\.\d{2}$/);
export const PocketAccountDtoSchema = z.object({
    account_id: z.uuid(), name: z.string(), owner_user_id: z.uuid(), owner_name: z.string(),
    currency: z.string(), balance: MoneySchema,
});
export const PocketDtoSchema = z.object({
    id: z.uuid(), name: z.string(), description: z.string().nullable(),
    balances: z.array(z.object({ currency: z.string(), balance: MoneySchema })),
    accounts: z.array(PocketAccountDtoSchema),
});
export type CreatePocketInput = z.infer<typeof CreatePocketSchema>;
export type UpdatePocketInput = z.infer<typeof UpdatePocketSchema>;
export type PocketDto = z.infer<typeof PocketDtoSchema>;
