import { Injectable } from '@nestjs/common';
import type { User } from '../../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { AccountRepository, isUniqueConflict, profile } from '../auth/account.repository.js';
import { AuthError } from '../auth/auth-error.js';
import { PasswordService } from '../auth/password.service.js';
import type { ProfileUpdateDto } from '../auth/auth.dto.js';

@Injectable()
export class UsersService {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly passwords: PasswordService,
    private readonly notifications: NotificationsService,
  ) {}
  private async confirm(user: User, password: string) {
    if (!(await this.passwords.matches(password, user.passwordHash)))
      throw new AuthError(403, 'CURRENT_PASSWORD_INVALID', 'The current password is incorrect.');
  }
  async settings(user: User) {
    const settings = await this.accounts.client.userSettings.findUnique({
      where: { userId: user.id },
    });
    return { autoSave: settings?.autoSave ?? false };
  }
  async updateSettings(snapshot: User, autoSave: boolean) {
    return this.accounts.transaction(async (tx) => {
      await this.accounts.confirmed(tx, snapshot);
      const settings = await tx.userSettings.upsert({
        where: { userId: snapshot.id },
        create: { userId: snapshot.id, autoSave },
        update: { autoSave },
      });
      return { autoSave: settings.autoSave };
    });
  }
  async update(snapshot: User, input: ProfileUpdateDto) {
    await this.confirm(snapshot, input.currentPassword);
    return this.accounts
      .transaction(async (tx) => {
        const user = await this.accounts.confirmed(tx, snapshot);
        const changed = input.email !== user.email;
        if (changed && (await tx.user.findUnique({ where: { email: input.email } })))
          throw new AuthError(409, 'EMAIL_UNAVAILABLE', 'This email is unavailable.');
        const updated = await tx.user.update({
          where: { id: user.id },
          data: { displayName: input.displayName },
        });
        if (changed) await this.notifications.issue(tx, user.id, 'email_change', input.email);
        else
          await tx.verificationToken.updateMany({
            where: { userId: user.id, purpose: 'email_change', consumedAt: null },
            data: { consumedAt: new Date() },
          });
        return { profile: profile(updated), verificationRequired: changed };
      })
      .catch((error: unknown) => {
        if (isUniqueConflict(error))
          throw new AuthError(409, 'EMAIL_UNAVAILABLE', 'This email is unavailable.');
        throw error;
      });
  }
  async changePassword(snapshot: User, current: string, next: string) {
    await this.confirm(snapshot, current);
    const passwordHash = await this.passwords.hash(next);
    await this.accounts.transaction(async (tx) => {
      await this.accounts.confirmed(tx, snapshot);
      await tx.user.update({
        where: { id: snapshot.id },
        data: { passwordHash, sessionVersion: { increment: 1 } },
      });
      await this.accounts.invalidate(tx, snapshot.id);
    });
  }
}
