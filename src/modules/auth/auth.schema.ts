import { z } from '../../common/openapi/zod.js';
import { UserStatusSchema } from '../users/user.schema.js';

const PasswordSchema = z.string().min(1).max(128);
const LoginByUsernameSchema = z.strictObject({
  username: z.string().trim().min(1).max(255).toLowerCase(),
  password: PasswordSchema,
});
const LoginByEmailSchema = z.strictObject({
  email: z.email().trim().toLowerCase(),
  password: PasswordSchema,
});

export const LoginSchema = z.union([LoginByUsernameSchema, LoginByEmailSchema]);

export const RefreshTokenSchema = z.strictObject({
  refresh_token: z.string().min(1),
});

export const AuthUserDtoSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email(),
  status: UserStatusSchema,
  roles: z.array(z.string()),
});

export const AuthPayloadDtoSchema = z.object({
  user: AuthUserDtoSchema,
  access_token: z.string(),
  refresh_token: z.string(),
  token_type: z.literal('Bearer'),
  expires_at: z.iso.datetime(),
  refresh_expires_at: z.iso.datetime(),
});

export type LoginInput = z.infer<typeof LoginSchema>;
export type RefreshTokenInput = z.infer<typeof RefreshTokenSchema>;
export type AuthPayloadDto = z.infer<typeof AuthPayloadDtoSchema>;
