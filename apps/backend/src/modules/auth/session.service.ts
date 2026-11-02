import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response, RequestHandler } from 'express';
import session from 'express-session';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { User } from '../../generated/prisma/client.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import {
  NOTIFICATION_CONFIG,
  type NotificationConfig,
} from '../notifications/notification-config.js';
import {
  AUTH_CONFIG,
  type AuthConfig,
  ANONYMOUS_TTL_MS,
  SESSION_IDLE_MS,
  SESSION_ABSOLUTE_MS,
} from './auth-config.js';
import { AccountRepository, profile } from './account.repository.js';
import { AuthError, unavailable } from './auth-error.js';
import type { SessionDto } from './auth.dto.js';
import { RevocableSessionStore } from '../../infrastructure/sessions/revocable-session.store.js';

declare module 'express-session' {
  interface SessionData {
    csrfToken?: string;
    principal?: {
      userId: string;
      version: number;
      absoluteExpiresAt: number;
      idleExpiresAt: number;
    };
  }
}
export type AuthRequest = Request & { authUser?: User };

@Injectable()
export class SessionService {
  readonly middleware: RequestHandler;
  readonly cookieName: string;
  readonly secure: boolean;
  constructor(
    redis: RedisService,
    private readonly accounts: AccountRepository,
    @Inject(AUTH_CONFIG) auth: AuthConfig,
    @Inject(NOTIFICATION_CONFIG) config: NotificationConfig,
  ) {
    this.secure = config.APP_ORIGIN.startsWith('https:');
    this.cookieName = this.secure ? '__Host-converter.sid' : 'converter.dev.sid';
    this.middleware = session({
      name: this.cookieName,
      secret: auth.SESSION_SECRET,
      store: new RevocableSessionStore(redis, (data) =>
        Math.max(
          1,
          Math.ceil(
            ((data.principal
              ? Math.min(data.principal.absoluteExpiresAt, data.principal.idleExpiresAt)
              : Date.now() + ANONYMOUS_TTL_MS) -
              Date.now()) /
              1000,
          ),
        ),
      ),
      resave: false,
      saveUninitialized: false,
      rolling: false,
      cookie: {
        httpOnly: true,
        secure: this.secure,
        sameSite: 'lax',
        path: '/',
        maxAge: ANONYMOUS_TTL_MS,
      },
    });
  }
  async save(request: Request) {
    await new Promise<void>((resolve, reject) =>
      request.session.save((error) => (error ? reject(unavailable()) : resolve())),
    );
  }
  async destroy(request: Request, response?: Response) {
    await new Promise<void>((resolve, reject) =>
      request.session.destroy((error) => (error ? reject(unavailable()) : resolve())),
    );
    response?.clearCookie(this.cookieName, {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'lax',
      path: '/',
    });
  }
  async user(request: AuthRequest, response: Response): Promise<User | undefined> {
    const principal = request.session.principal;
    if (!principal) return undefined;
    if (principal.absoluteExpiresAt <= Date.now() || principal.idleExpiresAt <= Date.now()) {
      await this.destroy(request, response);
      throw new AuthError(401, 'AUTH_REQUIRED', 'Please sign in again.');
    }
    const user = await this.accounts.client.user.findUnique({ where: { id: principal.userId } });
    if (!user || !user.emailVerifiedAt || user.sessionVersion !== principal.version) {
      await this.destroy(request, response);
      throw new AuthError(401, 'AUTH_REQUIRED', 'Please sign in again.');
    }
    principal.idleExpiresAt = Math.min(Date.now() + SESSION_IDLE_MS, principal.absoluteExpiresAt);
    request.session.cookie.maxAge = principal.idleExpiresAt - Date.now();
    await this.save(request);
    request.authUser = user;
    return user;
  }
  validCsrf(request: Request) {
    const received = request.get('X-CSRF-Token');
    const expected = request.session.csrfToken;
    return Boolean(
      received &&
      expected &&
      Buffer.byteLength(received) === Buffer.byteLength(expected) &&
      timingSafeEqual(Buffer.from(received), Buffer.from(expected)),
    );
  }
  async csrf(request: Request) {
    request.session.csrfToken ??= randomBytes(32).toString('base64url');
    await this.save(request);
    return { csrfToken: request.session.csrfToken };
  }
  async login(request: Request, user: User): Promise<SessionDto> {
    await new Promise<void>((resolve, reject) =>
      request.session.regenerate((error) => (error ? reject(unavailable()) : resolve())),
    );
    const now = Date.now();
    request.session.csrfToken = randomBytes(32).toString('base64url');
    request.session.principal = {
      userId: user.id,
      version: user.sessionVersion,
      absoluteExpiresAt: now + SESSION_ABSOLUTE_MS,
      idleExpiresAt: now + SESSION_IDLE_MS,
    };
    request.session.cookie.maxAge = SESSION_IDLE_MS;
    await this.save(request);
    return this.describe(request, user);
  }
  describe(request: Request, user?: User): SessionDto {
    return user && request.session.principal
      ? {
          kind: 'authenticated',
          user: profile(user),
          expiresAt: new Date(
            Math.min(
              request.session.principal.absoluteExpiresAt,
              request.session.principal.idleExpiresAt,
            ),
          ).toISOString(),
        }
      : { kind: 'anonymous' };
  }
}
