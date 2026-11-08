import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import { bounded } from '../../infrastructure/dependency.js';
import { AccountRepository } from './account.repository.js';
import { unavailable } from './auth-error.js';

export const REGISTRATION_TTL_MS = 15 * 60_000;
export type RegistrationAccount = { id: string; email: string; sessionVersion: number };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const recordSchema = z.object({
  expiresAt: z.number(),
  account: z.object({ id: z.string(), emailHash: z.string(), version: z.number() }).nullable(),
});

@Injectable()
export class RegistrationStatusService {
  constructor(
    private readonly redis: RedisService,
    private readonly accounts: AccountRepository,
  ) {}

  private key(sessionId: string, receipt: string) {
    return this.redis.sessionPrefix + 'registration:' + hash(JSON.stringify([sessionId, receipt]));
  }

  async issue(sessionId: string, account: RegistrationAccount | null) {
    const receipt = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + REGISTRATION_TTL_MS;
    try {
      const stored = await bounded(
        this.redis.client.set(
          this.key(sessionId, receipt),
          JSON.stringify({
            expiresAt,
            account: account
              ? { id: account.id, emailHash: hash(account.email), version: account.sessionVersion }
              : null,
          }),
          { PX: REGISTRATION_TTL_MS },
        ),
        5_000,
      );
      if (stored !== 'OK') throw unavailable();
    } catch {
      // Registration may already have committed. Never compensate or replay it.
      throw unavailable();
    }
    return { receipt, expiresAt: new Date(expiresAt).toISOString() };
  }

  async read(
    sessionId: string,
    receipt: string,
  ): Promise<{ status: 'pending' | 'verified' | 'expired' }> {
    try {
      const raw = await bounded(this.redis.client.get(this.key(sessionId, receipt)), 5_000);
      if (!raw) return { status: 'expired' };
      const record = recordSchema.parse(JSON.parse(raw));
      if (record.expiresAt <= Date.now()) return { status: 'expired' };
      const user = await this.accounts.client.user.findUnique({
        // Decoys take the same dependency path, without looking up the submitted email.
        where: { id: record.account?.id ?? randomUUID() },
        select: { email: true, emailVerifiedAt: true, sessionVersion: true },
      });
      if (record.expiresAt <= Date.now()) return { status: 'expired' };
      if (!record.account) return { status: 'pending' };
      if (
        !user ||
        hash(user.email) !== record.account.emailHash ||
        user.sessionVersion !== record.account.version
      )
        return { status: 'expired' };
      if (record.expiresAt <= Date.now()) return { status: 'expired' };
      return { status: user.emailVerifiedAt ? 'verified' : 'pending' };
    } catch {
      throw unavailable();
    }
  }
}
