import { z } from '../../common/openapi/zod.js';

const ProfileFields = {
  full_name: z.string().trim().min(1).max(120).nullable(),
  phone_number: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{3,32}$/)
    .nullable(),
  gender: z.enum(['Laki-laki', 'Perempuan']).nullable(),
  photo: z
    .uuid()
    .nullable()
    .describe('Owned, non-deleted uploaded JPEG, PNG, or WebP file ID; never a URL.'),
  base_currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .describe('Three-letter uppercase currency code; default IDR. No FX conversion.'),
  theme: z.enum(['light', 'dark', 'system']),
};

export const PatchProfileSchema = z
  .strictObject(ProfileFields)
  .partial()
  .refine((input) => Object.keys(input).length > 0, {
    message: 'Minimal satu kolom profil wajib diisi.',
  });

export const ProfileDtoSchema = z.strictObject({
  user_id: z.uuid(),
  ...ProfileFields,
  created_at: z.iso.datetime().nullable(),
  updated_at: z.iso.datetime().nullable(),
  deleted_at: z.iso.datetime().nullable(),
});

export type PatchProfileInput = z.infer<typeof PatchProfileSchema>;
export type ProfileDto = z.infer<typeof ProfileDtoSchema>;
