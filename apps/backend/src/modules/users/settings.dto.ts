import { IsBoolean } from 'class-validator';

export class SettingsUpdateDto {
  @IsBoolean()
  autoSave!: boolean;
}
