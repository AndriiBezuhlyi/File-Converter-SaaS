import { FixtureAuthGateway } from './auth-gateway';
import { wait } from './gateway';
import type { AccountGateway, AccountProfile } from '../src/features/account/lib/account-gateway';
import type { ApiKeyGateway, ApiKeyMetadata } from '../src/features/api-keys/lib/api-key-gateway';
import { DataAccessError } from '../src/shared/lib/data-access-error';

export class FixtureAccountGateway
  extends FixtureAuthGateway
  implements AccountGateway, ApiKeyGateway
{
  override readonly scope = 'fixture-account';
  private profile: AccountProfile = { displayName: 'Олена', email: 'reader@example.test' };
  private settings = { autoSave: true };
  private key: ApiKeyMetadata | null;
  private keyVersion = 0;
  constructor(readonly accountScenario: string) {
    super(accountScenario === 'anonymous' ? 'success' : 'signed-in');
    this.key =
      accountScenario === 'no-key'
        ? null
        : { prefix: 'demo_initial', createdAt: '2026-10-22T12:00:00Z' };
  }
  async readProfile(signal: AbortSignal) {
    await this.read('profile', signal);
    return this.profile;
  }
  async readSettings(signal: AbortSignal) {
    await this.read('settings', signal);
    return this.settings;
  }
  async readKey(signal: AbortSignal) {
    await this.read('key', signal);
    return this.key;
  }
  async setAutoSave(autoSave: boolean) {
    await this.change('save-settings');
    if (this.accountScenario === 'settings-error' && this.calls['save-settings'] === 1)
      throw new DataAccessError('network');
    this.settings = { autoSave };
    if (this.accountScenario === 'settings-unknown' && this.calls['save-settings'] === 1)
      throw new DataAccessError('network');
    return this.settings;
  }
  async updateProfile(input: AccountProfile & { currentPassword: string }) {
    await this.change('save-profile', input.currentPassword);
    if (this.accountScenario === 'profile-error') throw new DataAccessError('network');
    const verificationRequired = input.email !== this.profile.email;
    this.profile = { ...this.profile, displayName: input.displayName };
    return { profile: this.profile, verificationRequired };
  }
  async changePassword(input: { currentPassword: string; newPassword: string }) {
    await this.change('save-password', input.currentPassword);
    this.session = { kind: 'anonymous' };
  }
  async createKey(currentPassword: string) {
    return this.issueKey('create-key', currentPassword);
  }
  async rotateKey(currentPassword: string) {
    return this.issueKey('rotate-key', currentPassword);
  }
  private async issueKey(operation: string, password: string) {
    await this.change(operation, password);
    if ((operation === 'create-key' && this.key) || (operation === 'rotate-key' && !this.key))
      throw new DataAccessError('rejected');
    this.keyVersion += 1;
    this.key = { prefix: `demo_${this.keyVersion}`, createdAt: '2026-10-22T13:00:00Z' };
    if (this.accountScenario === 'key-unknown' && this.keyVersion === 1)
      throw new DataAccessError('network');
    return { metadata: this.key, secret: `fixture_key_public_demo_${this.keyVersion}` };
  }
  private assertSession() {
    if (this.session.kind !== 'authenticated') throw new DataAccessError('unauthorized');
  }
  private async read(operation: string, signal: AbortSignal) {
    this.calls[operation] = (this.calls[operation] ?? 0) + 1;
    await wait(100, signal);
    this.assertSession();
    if (this.accountScenario === `${operation}-read-error` && this.calls[operation] === 1)
      throw new DataAccessError('network');
  }
  private async change(operation: string, password?: string) {
    this.calls[operation] = (this.calls[operation] ?? 0) + 1;
    await wait(400);
    this.assertSession();
    if (password === 'wrong') throw new DataAccessError('confirmation');
  }
}
