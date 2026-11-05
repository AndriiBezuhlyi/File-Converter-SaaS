import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ApiKey, User } from '../../generated/prisma/client.js';
import { AccountRepository } from '../auth/account.repository.js';
import { AuthError } from '../auth/auth-error.js';
import { PasswordService } from '../auth/password.service.js';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const metadata = (key: Pick<ApiKey, 'prefix' | 'createdAt'>) => ({
  prefix: key.prefix,
  createdAt: key.createdAt.toISOString(),
});
const invalidKey = () => new AuthError(401, 'API_KEY_INVALID', 'A valid API key is required.');

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly passwords: PasswordService,
  ) {}
  async read(user: User) {
    const key = await this.accounts.client.apiKey.findFirst({
      where: { userId: user.id, revokedAt: null },
      select: { prefix: true, createdAt: true },
    });
    return { key: key ? metadata(key) : null };
  }
  async change(snapshot: User, password: string, operation: 'create' | 'rotate' | 'revoke') {
    if (!(await this.passwords.matches(password, snapshot.passwordHash)))
      throw new AuthError(403, 'CURRENT_PASSWORD_INVALID', 'The current password is incorrect.');
    // Random lookup prefix and 256-bit secret; only the full credential's digest is persisted.
    const prefix = 'fc_' + randomBytes(12).toString('hex');
    const secret = prefix + '.' + randomBytes(32).toString('base64url');
    return this.accounts.transaction(async (tx) => {
      await this.accounts.confirmed(tx, snapshot);
      const active = await tx.apiKey.findFirst({ where: { userId: snapshot.id, revokedAt: null } });
      if (operation === 'create' && active)
        throw new AuthError(409, 'API_KEY_EXISTS', 'Rotate or revoke the active key first.');
      if (operation === 'rotate' && !active)
        throw new AuthError(409, 'API_KEY_MISSING', 'Create a key first.');
      await tx.apiKey.updateMany({
        where: { userId: snapshot.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (operation === 'revoke') return null;
      const key = await tx.apiKey.create({
        data: { userId: snapshot.id, prefix, secretHash: digest(secret) },
      });
      return { metadata: metadata(key), secret };
    });
  }
  async authenticate(value: unknown): Promise<{ kind: 'api'; userId: string }> {
    if (typeof value !== 'string' || !/^fc_[a-f0-9]{24}\.[A-Za-z0-9_-]{43}$/.test(value))
      throw invalidKey();
    const prefix = value.split('.')[0]!;
    const key = await this.accounts.client.apiKey.findUnique({
      where: { prefix },
      include: { user: { select: { emailVerifiedAt: true } } },
    });
    if (!key || key.revokedAt || !key.user.emailVerifiedAt) throw invalidKey();
    const expected = Buffer.from(key.secretHash, 'hex');
    const received = Buffer.from(digest(value), 'hex');
    if (expected.length !== received.length || !timingSafeEqual(expected, received))
      throw invalidKey();
    return { kind: 'api', userId: key.userId };
  }
}
