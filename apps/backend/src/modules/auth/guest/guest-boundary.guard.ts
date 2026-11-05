import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthError } from '../auth-error.js';
import { SessionService } from '../session.service.js';
import { RateLimitService } from '../rate-limit.service.js';
import {
  NOTIFICATION_CONFIG,
  type NotificationConfig,
} from '../../notifications/notification-config.js';
import { GuestCredentialsService } from './guest-credentials.service.js';

@Injectable()
export class GuestBoundaryGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly rates: RateLimitService,
    private readonly credentials: GuestCredentialsService,
    @Inject(NOTIFICATION_CONFIG) private readonly config: NotificationConfig,
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    if (request.headers['x-api-key'] !== undefined)
      throw new AuthError(401, 'AUTH_REQUIRED', 'API keys cannot bootstrap guest access.');
    const ip = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    await this.rates.check('guest-bootstrap', ip, 30, 60_000, response);
    if (request.get('Origin') !== this.config.APP_ORIGIN)
      throw new AuthError(403, 'ORIGIN_FORBIDDEN', 'Request origin is not allowed.');
    if (!this.sessions.validCsrf(request))
      throw new AuthError(403, 'CSRF_INVALID', 'Refresh your session and try again.');
    if (this.credentials.read(request) === undefined)
      await this.rates.check('guest-issuance', ip, 5, 15 * 60_000, response);
    // Guest capability is independent of a stale, unverified or revoked account session.
    return true;
  }
}
