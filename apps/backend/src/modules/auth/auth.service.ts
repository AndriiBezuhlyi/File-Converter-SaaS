import { Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { TokenPurpose, User } from '../../generated/prisma/client.js';
import { NotificationsService, tokenHash } from '../notifications/notifications.service.js';
import { AccountRepository, isUniqueConflict } from './account.repository.js';
import { AuthError, invalidToken } from './auth-error.js';
import { PasswordService } from './password.service.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly passwords: PasswordService,
    private readonly notifications: NotificationsService,
  ) {}

  async register(email: string, password: string) {
    const passwordHash = await this.passwords.hash(password);
    try {
      await this.accounts.transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email, passwordHash, settings: { create: {} } },
        });
        await this.notifications.issue(tx, user.id, 'email_verification', email);
      });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
    }
  }
  async login(email: string, password: string): Promise<User> {
    const user = await this.accounts.client.user.findUnique({ where: { email } });
    const valid = await this.passwords.matches(password, user?.passwordHash);
    if (!user || !valid)
      throw new AuthError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    if (!user.emailVerifiedAt)
      throw new AuthError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email before signing in.');
    // Any reset racing this return invalidates the saved version at the next authenticated boundary.
    return user;
  }
  async requestLink(email: string, purpose: 'email_verification' | 'password_reset') {
    const snapshot = await this.accounts.client.user.findUnique({ where: { email } });
    if (!snapshot) return;
    await this.accounts.transaction(async (tx) => {
      const user = await this.accounts.lock(tx, snapshot.id);
      if (
        !user ||
        user.email !== email ||
        (purpose === 'email_verification' && user.emailVerifiedAt) ||
        (purpose === 'password_reset' && !user.emailVerifiedAt)
      )
        return;
      await this.notifications.issue(tx, user.id, purpose, email);
    });
  }
  async consume(raw: string, purposes: TokenPurpose[], passwordHash?: string) {
    const id = raw.split('.')[0]!;
    const snapshot = await this.accounts.client.verificationToken.findUnique({ where: { id } });
    if (!snapshot) throw invalidToken();
    // Lock order is always user -> tokens, including resend and profile changes.
    const result = await this.accounts
      .transaction(async (tx) => {
        const user = await this.accounts.lock(tx, snapshot.userId);
        const token = await tx.verificationToken.findUnique({ where: { id } });
        const now = new Date();
        if (
          !user ||
          !token ||
          token.consumedAt ||
          token.expiresAt <= now ||
          token.attempts >= 5 ||
          !purposes.includes(token.purpose)
        )
          return false;
        const valid = timingSafeEqual(
          Buffer.from(token.tokenHash, 'hex'),
          Buffer.from(tokenHash(raw), 'hex'),
        );
        if (!valid) {
          await tx.verificationToken.update({
            where: { id },
            data: { attempts: { increment: 1 } },
          });
          return false;
        }
        if (token.purpose === 'email_verification') {
          await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: now } });
          await tx.verificationToken.update({ where: { id }, data: { consumedAt: now } });
        } else if (token.purpose === 'password_reset' && passwordHash) {
          await tx.user.update({
            where: { id: user.id },
            data: { passwordHash, sessionVersion: { increment: 1 } },
          });
          await this.accounts.invalidate(tx, user.id);
        } else if (token.purpose === 'email_change' && token.pendingEmail) {
          if (await tx.user.findUnique({ where: { email: token.pendingEmail } })) return false;
          await tx.user.update({
            where: { id: user.id },
            data: {
              email: token.pendingEmail,
              emailVerifiedAt: now,
              sessionVersion: { increment: 1 },
            },
          });
          await this.accounts.invalidate(tx, user.id);
        } else return false;
        return true;
      })
      .catch((error: unknown) => {
        if (isUniqueConflict(error)) return false;
        throw error;
      });
    if (!result) throw invalidToken();
  }
  verify(token: string) {
    return this.consume(token, ['email_verification', 'email_change']);
  }
  async reset(token: string, password: string) {
    return this.consume(token, ['password_reset'], await this.passwords.hash(password));
  }
}
