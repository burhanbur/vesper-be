import type { ProfileRepository } from './profile.repository.js';
import type { PatchProfileInput, ProfileDto } from './profile.schema.js';
import { toProfileDto } from './profile.types.js';

export class ProfileService {
  constructor(private readonly repository: ProfileRepository) {}

  async get(userId: string): Promise<ProfileDto> {
    const profile = await this.repository.findByUserId(userId);
    return profile
      ? toProfileDto(profile)
      : {
          user_id: userId,
          full_name: null,
          phone_number: null,
          gender: null,
          photo: null,
          base_currency: 'IDR',
          theme: 'system',
          created_at: null,
          updated_at: null,
          deleted_at: null,
        };
  }

  async patch(userId: string, input: PatchProfileInput): Promise<ProfileDto> {
    return toProfileDto(await this.repository.patch(userId, input));
  }
}
