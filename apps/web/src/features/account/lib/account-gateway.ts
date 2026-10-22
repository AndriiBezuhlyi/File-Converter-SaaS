// Frontend view models, not HTTP DTOs. Scope must identify the current account context.
export interface AccountProfile {
  displayName: string;
  email: string;
}
export interface AccountSettings {
  autoSave: boolean;
}
export interface SettingsGateway {
  readonly scope: string;
  readSettings(signal: AbortSignal): Promise<AccountSettings>;
  setAutoSave(value: boolean): Promise<AccountSettings>;
}
export interface AccountGateway extends SettingsGateway {
  readProfile(signal: AbortSignal): Promise<AccountProfile>;
  updateProfile(
    input: AccountProfile & { currentPassword: string },
  ): Promise<{ profile: AccountProfile; verificationRequired: boolean }>;
  changePassword(input: { currentPassword: string; newPassword: string }): Promise<void>;
}
