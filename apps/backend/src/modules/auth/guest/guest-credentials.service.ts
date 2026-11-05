import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { DatabaseService } from '../../../infrastructure/database/database.service.js';
import type { GuestSession } from '../../../generated/prisma/client.js';
import {
  NOTIFICATION_CONFIG,
  type NotificationConfig,
} from '../../notifications/notification-config.js';
import { GUEST_CONFIG, type GuestConfig } from './guest-config.js';
import { invalidGuest } from './guest-error.js';
import type { GuestPrincipal, GuestSessionDto } from './guest.types.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

@Injectable()
export class GuestCredentialsService {
  readonly cookieName: string;
  private readonly secure: boolean;
  constructor(
    private readonly database: DatabaseService,
    @Inject(GUEST_CONFIG) private readonly config: GuestConfig,
    @Inject(NOTIFICATION_CONFIG) notification: NotificationConfig,
  ) {
    this.secure = notification.APP_ORIGIN.startsWith('https:');
    this.cookieName = this.secure ? '__Host-converter.guest' : 'converter.dev.guest';
  }
  read(request: Request): string | undefined {
    const matches = (request.headers.cookie ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(this.cookieName + '='));
    if (!matches.length) return undefined;
    if (matches.length !== 1) throw invalidGuest();
    const token = matches[0]!.slice(this.cookieName.length + 1);
    if (!tokenPattern.test(token)) throw invalidGuest();
    return token;
  }
  private setCookie(response: Response, token: string, guest: GuestSession) {
    response.cookie(this.cookieName, token, {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'lax',
      path: '/',
      expires: guest.credentialExpiresAt,
    });
  }
  async resolve(token: string): Promise<GuestPrincipal> {
    const guest = await this.resolveRecord(token);
    return { kind: 'guest', guestSessionId: guest.id, tokenHash: guest.tokenHash };
  }
  private async resolveRecord(token: string): Promise<GuestSession> {
    if (!tokenPattern.test(token)) throw invalidGuest();
    const tokenHash = hash(token);
    const rows = await this.database.client.$queryRaw<GuestSession[]>`
      SELECT * FROM "GuestSession" WHERE "tokenHash" = ${tokenHash} AND "credentialExpiresAt" > clock_timestamp()`;
    if (!rows[0]) throw invalidGuest();
    return rows[0];
  }
  async bootstrap(token: string | undefined, response: Response): Promise<GuestSessionDto> {
    let guest: GuestSession;
    if (token === undefined) {
      token = randomBytes(32).toString('base64url');
      const id = randomUUID();
      // One database clock defines the persisted lifetime and the absolute browser expiry.
      const rows = await this.database.client.$queryRaw<GuestSession[]>`
        INSERT INTO "GuestSession" ("id", "tokenHash", "createdAt", "credentialExpiresAt")
        VALUES (${id}::uuid, ${hash(token)}, clock_timestamp(), clock_timestamp() + ${this.config.GUEST_CREDENTIAL_TTL_SECONDS} * interval '1 second') RETURNING *`;
      guest = rows[0]!;
    } else {
      guest = await this.resolveRecord(token);
    }
    this.setCookie(response, token, guest);
    return { trialState: guest.trialState, activeConversionId: guest.reservedConversionId };
  }
}
