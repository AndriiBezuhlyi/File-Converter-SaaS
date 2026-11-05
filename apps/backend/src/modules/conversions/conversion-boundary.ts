import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
  type NestMiddleware,
} from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { ApiKeysService } from '../api-keys/api-keys.service.js';
import { AuthError } from '../auth/auth-error.js';
import { AuthSessionMiddleware } from '../auth/auth-boundary.js';
import { SessionService } from '../auth/session.service.js';
import { RateLimitService } from '../auth/rate-limit.service.js';
import { GuestCredentialsService } from '../auth/guest/guest-credentials.service.js';
import type { GuestPrincipal } from '../auth/guest/guest.types.js';
import {
  NOTIFICATION_CONFIG,
  type NotificationConfig,
} from '../notifications/notification-config.js';

export type ConversionPrincipal = GuestPrincipal | { kind: 'account' | 'api'; userId: string };
export type ConversionRequest = Request & {
  conversionPrincipal: ConversionPrincipal;
  retainedGuest?: GuestPrincipal;
};

@Injectable()
export class ConversionSessionMiddleware implements NestMiddleware {
  constructor(private readonly sessions: AuthSessionMiddleware) {}
  use(request: Request, response: Response, next: NextFunction) {
    response.setHeader('Cache-Control', 'no-store');
    if (request.headers['x-api-key'] !== undefined) return next();
    this.sessions.use(request, response, next);
  }
}

@Injectable()
export class ConversionBoundaryGuard implements CanActivate {
  constructor(
    private readonly keys: ApiKeysService,
    private readonly sessions: SessionService,
    private readonly guests: GuestCredentialsService,
    private readonly rates: RateLimitService,
    @Inject(NOTIFICATION_CONFIG) private readonly config: NotificationConfig,
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<ConversionRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const submitting = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    await this.rates.check(
      submitting ? 'conversion:upload:ip' : 'conversion:poll:ip',
      request.ip ?? request.socket.remoteAddress ?? 'unknown',
      submitting ? 20 : 120,
      60_000,
      response,
    );
    if (request.headers['x-api-key'] !== undefined) {
      request.conversionPrincipal = await this.keys.authenticate(request.headers['x-api-key']);
    } else {
      if (submitting) {
        if (request.get('Origin') !== this.config.APP_ORIGIN)
          throw new AuthError(403, 'ORIGIN_FORBIDDEN', 'Request origin is not allowed.');
        if (!this.sessions.validCsrf(request))
          throw new AuthError(403, 'CSRF_INVALID', 'Refresh your session and try again.');
      }
      let user;
      try {
        user = await this.sessions.user(request, response);
      } catch (error) {
        if (submitting || !(error instanceof AuthError) || error.getStatus() !== 401) throw error;
      }
      if (user) request.conversionPrincipal = { kind: 'account', userId: user.id };
      // A retained guest cookie can authorize only that guest's old reads, even after login.
      if (!user || !submitting) {
        try {
          const token = this.guests.read(request);
          if (token !== undefined) request.retainedGuest = await this.guests.resolve(token);
        } catch (error) {
          if (!user) throw error;
        }
      }
      if (!user) {
        if (!request.retainedGuest)
          throw new AuthError(
            401,
            'AUTH_REQUIRED',
            'A user session, guest context or API key is required.',
          );
        request.conversionPrincipal = request.retainedGuest;
      }
    }
    const principal = request.conversionPrincipal;
    await this.rates.check(
      submitting ? 'conversion:upload:principal' : 'conversion:poll:principal',
      principal.kind === 'guest' ? principal.guestSessionId : principal.userId,
      submitting ? 10 : 120,
      60_000,
      response,
    );
    return true;
  }
}
