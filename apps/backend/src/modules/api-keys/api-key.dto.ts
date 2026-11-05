import { IsString, Length } from 'class-validator';

export class KeyConfirmationDto {
  @IsString()
  @Length(1, 128)
  currentPassword!: string;
}
