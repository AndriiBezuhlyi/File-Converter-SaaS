import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, MaxLength, Matches, ValidateIf, Equals } from 'class-validator';
import { z } from 'zod';

export class EmailDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @Matches(z.regexes.email)
  @MaxLength(254)
  email!: string;
}
export class EmptyDto {}
export class LoginDto extends EmailDto {
  @IsString()
  @Length(1, 128)
  password!: string;
}
export class RegisterDto extends EmailDto {
  @IsString()
  @Length(10, 128)
  password!: string;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @Equals(true)
  trackStatus?: true;
}
export class RegistrationStatusDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  receipt!: string;
}
export class TokenDto {
  @IsString()
  @Matches(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/,
  )
  token!: string;
}
export class PasswordResetDto extends TokenDto {
  @IsString()
  @Length(10, 128)
  newPassword!: string;
}
export class PasswordChangeDto {
  @IsString()
  @Length(1, 128)
  currentPassword!: string;

  @IsString()
  @Length(10, 128)
  newPassword!: string;
}
export class ProfileUpdateDto extends EmailDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(80)
  displayName!: string;

  @IsString()
  @Length(1, 128)
  currentPassword!: string;
}
export interface ProfileDto {
  id: string;
  email: string;
  displayName: string;
}
export type SessionDto =
  { kind: 'anonymous' } | { kind: 'authenticated'; user: ProfileDto; expiresAt: string };
export const accepted = { status: 'accepted' } as const;
