import { AppError } from '../../common/errors/app-error.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { PatchProfileInput } from './profile.schema.js';
import type { ProfileRecord } from './profile.types.js';

export interface ProfileRepository {
  findByUserId(userId: string): Promise<ProfileRecord | null>;
  patch(userId: string, input: PatchProfileInput): Promise<ProfileRecord>;
}

function profileData(input: PatchProfileInput) {
  let gender: 'MALE' | 'FEMALE' | null | undefined;
  if (input.gender === null) gender = null;
  if (input.gender === 'Laki-laki') gender = 'MALE';
  if (input.gender === 'Perempuan') gender = 'FEMALE';
  return {
    ...(input.full_name !== undefined ? { fullName: input.full_name } : {}),
    ...(input.phone_number !== undefined ? { phoneNumber: input.phone_number } : {}),
    ...(gender !== undefined ? { gender } : {}),
    ...(input.photo !== undefined ? { photo: input.photo } : {}),
    ...(input.base_currency !== undefined ? { baseCurrency: input.base_currency } : {}),
    ...(input.theme !== undefined ? { theme: input.theme } : {}),
  };
}

export class PrismaProfileRepository implements ProfileRepository {
  constructor(private readonly client: PrismaClient) {}

  findByUserId(userId: string): Promise<ProfileRecord | null> {
    return this.client.userProfile.findFirst({ where: { userId, deletedAt: null } });
  }

  async patch(userId: string, input: PatchProfileInput): Promise<ProfileRecord> {
    return this.client.$transaction(async (transaction) => {
      if (input.photo) {
        const photo = await transaction.storedFile.findFirst({
          where: {
            id: input.photo,
            createdBy: userId,
            deletedAt: null,
            mimeType: { in: ['image/jpeg', 'image/png', 'image/webp'] },
          },
          select: { id: true },
        });
        if (!photo) {
          throw new AppError({
            statusCode: 422,
            code: 'INVALID_PROFILE_PHOTO',
            message: 'Foto harus berupa file gambar unggahan milik Anda yang masih tersedia.',
          });
        }
      }
      const existing = await transaction.userProfile.findUnique({
        where: { userId },
        select: { deletedAt: true },
      });
      if (existing?.deletedAt) {
        throw new AppError({
          statusCode: 409,
          code: 'PROFILE_DELETED',
          message: 'Profil tidak dapat diperbarui.',
        });
      }
      const data = profileData(input);
      return transaction.userProfile.upsert({
        where: { userId },
        create: { userId, ...data },
        update: data,
      });
    });
  }
}
