import { FixtureAuthGateway } from './auth-gateway';
import { wait } from './gateway';
import type { AccountGateway, AccountProfile } from '../src/features/account/lib/account-gateway';
import type { ApiKeyGateway, ApiKeyMetadata } from '../src/features/api-keys/lib/api-key-gateway';
import { DataAccessError } from '../src/shared/lib/data-access-error';
import type { FilesFilter, FilesGateway, SavedFile } from '../src/features/files/lib/files-gateway';
import pngUrl from './assets/example.png?url';
import jpgUrl from './assets/example.jpg?url';
import pdfUrl from './assets/example.pdf?url';

export class FixtureAccountGateway
  extends FixtureAuthGateway
  implements AccountGateway, ApiKeyGateway, FilesGateway
{
  override readonly scope = 'fixture-account';
  private profile: AccountProfile = { displayName: 'Олена', email: 'reader@example.test' };
  private settings = { autoSave: true };
  private key: ApiKeyMetadata | null;
  private keyVersion = 0;
  private files: SavedFile[] = [
    {
      id: 'file_1',
      name: 'example-image.png',
      format: 'png',
      sizeBytes: 90,
      createdAt: '2026-10-22T12:00:00Z',
    },
    {
      id: 'file_2',
      name: 'notes.pdf',
      format: 'pdf',
      sizeBytes: 591,
      createdAt: '2026-10-21T12:00:00Z',
    },
    {
      id: 'file_3',
      name: 'sample-photo.jpg',
      format: 'jpg',
      sizeBytes: 268,
      createdAt: '2026-10-20T12:00:00Z',
    },
    {
      id: 'file_4',
      name: 'another-image.png',
      format: 'png',
      sizeBytes: 90,
      createdAt: '2026-10-19T12:00:00Z',
    },
    {
      id: 'file_5',
      name: 'another-notes.pdf',
      format: 'pdf',
      sizeBytes: 591,
      createdAt: '2026-10-18T12:00:00Z',
    },
  ];
  constructor(readonly accountScenario: string) {
    super(accountScenario === 'anonymous' ? 'success' : 'signed-in');
    this.key =
      accountScenario === 'no-key'
        ? null
        : { prefix: 'demo_initial', createdAt: '2026-10-22T12:00:00Z' };
    if (accountScenario === 'empty') this.files = [];
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
  async list(input: FilesFilter & { cursor: string | null }, signal: AbortSignal) {
    await this.read('files', signal);
    if (this.accountScenario === 'next-page-error' && input.cursor && this.calls.files === 2)
      throw new DataAccessError('network');
    const filtered = this.files
      .filter(
        (file) =>
          (input.format === 'all' || file.format === input.format) &&
          file.name.toLocaleLowerCase('uk-UA').includes(input.search.toLocaleLowerCase('uk-UA')),
      )
      .sort((a, b) =>
        input.order === 'newest'
          ? b.createdAt.localeCompare(a.createdAt)
          : a.createdAt.localeCompare(b.createdAt),
      );
    const start = input.cursor ? filtered.findIndex((file) => file.id === input.cursor) + 1 : 0;
    const files = filtered.slice(start, start + 3);
    return { files, nextCursor: start + 3 < filtered.length ? files.at(-1)!.id : null };
  }
  async download(id: string) {
    await this.change('download-file');
    if (this.accountScenario === 'download-error' && this.calls['download-file'] === 1)
      throw new DataAccessError('network');
    const file = this.files.find((file) => file.id === id);
    if (!file) throw new DataAccessError('not-found');
    if (this.accountScenario === 'download-denied') {
      this.files = this.files.filter((entry) => entry.id !== id);
      throw new DataAccessError('expired');
    }
    const response = await fetch(
      file.format === 'png' ? pngUrl : file.format === 'jpg' ? jpgUrl : pdfUrl,
    );
    if (!response.ok) throw new DataAccessError('network');
    return { blob: await response.blob(), name: file.name };
  }
  async remove(id: string) {
    await this.change('delete-file');
    if (this.accountScenario === 'delete-error' && this.calls['delete-file'] === 1)
      throw new DataAccessError('network');
    this.files = this.files.filter((file) => file.id !== id);
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
