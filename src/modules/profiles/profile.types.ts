import type { UserProfile } from '../../generated/prisma/client.js';
import { ProfileDtoSchema, type ProfileDto } from './profile.schema.js';

export type ProfileRecord = UserProfile;

export function toProfileDto(profile: ProfileRecord): ProfileDto {
  const genderLabels = { MALE: 'Laki-laki', FEMALE: 'Perempuan' } as const;
  const gender = profile.gender === null ? null : genderLabels[profile.gender];
  return ProfileDtoSchema.parse({
    user_id: profile.userId,
    full_name: profile.fullName,
    phone_number: profile.phoneNumber,
    gender,
    photo: profile.photo,
    base_currency: profile.baseCurrency,
    theme: profile.theme,
    created_at: profile.createdAt.toISOString(),
    updated_at: profile.updatedAt.toISOString(),
    deleted_at: profile.deletedAt?.toISOString() ?? null,
  });
}
