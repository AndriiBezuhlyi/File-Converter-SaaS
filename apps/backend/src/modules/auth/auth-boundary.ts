import {
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
  type NestMiddleware,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response, NextFunction } from 'express';
import {
  NOTIFICATION_CONFIG,
  type NotificationConfig,
} from '../notifications/notification-config.js';
import { AuthError, unavailable } from './auth-error.js';
import { SessionService, type AuthRequest } from './session.service.js';
import { RateLimitService } from './rate-limit.service.js';

export type Policy =
  'public' | 'login' | 'link' | 'token' | 'csrf' | 'account' | 'sensitive' | 'registration-status';
export const AuthPolicy = (policy: Policy) => SetMetadata('authPolicy', policy);

@Injectable()
export class AuthSessionMiddleware implements NestMiddleware {
  constructor(private readonly sessions: SessionService) {}
  use(request: Request, response: Response, next: NextFunction) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    this.sessions.middleware(request, response, (error?: unknown) => {
      if (error) {
        response.status(503).json(unavailable().getResponse());
        return;
      }
      next();
    });
  }
}
@Injectable()
export class AuthBoundaryGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly rates: RateLimitService,
    @Inject(NOTIFICATION_CONFIG) private readonly config: NotificationConfig,
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const policy = this.reflector.get<Policy>('authPolicy', context.getHandler()) ?? 'public';
    if (request.headers['x-api-key'] !== undefined)
      throw new AuthError(401, 'AUTH_REQUIRED', 'This operation requires a first-party session.');
    const ip = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    await this.rates.check('global', ip, 120, 60_000, response);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      if (request.get('Origin') !== this.config.APP_ORIGIN)
        throw new AuthError(403, 'ORIGIN_FORBIDDEN', 'Request origin is not allowed.');
      if (!this.sessions.validCsrf(request))
        throw new AuthError(403, 'CSRF_INVALID', 'Refresh your session and try again.');
    }
    const user = await this.sessions.user(request, response);
    if (policy === 'account' || policy === 'sensitive') {
      if (!user) throw new AuthError(401, 'AUTH_REQUIRED', 'Please sign in.');
      if (policy === 'sensitive')
        await this.rates.check('sensitive', user.id, 5, 15 * 60_000, response);
    }
    if (policy === 'csrf') await this.rates.check('csrf', ip, 30, 60_000, response);
    if (policy === 'token') await this.rates.check('token', ip, 10, 60_000, response);
    if (policy === 'registration-status') {
      await this.rates.check('registration-status:ip', ip, 60, 60_000, response);
      await this.rates.check(
        'registration-status:session',
        request.sessionID,
        30,
        60_000,
        response,
      );
    }
    if (policy === 'login' || policy === 'link') {
      const body: unknown = request.body;
      const email =
        body && typeof body === 'object' && 'email' in body && typeof body.email === 'string'
          ? body.email.trim().toLowerCase().slice(0, 254)
          : 'invalid';
      const scope = policy === 'login' ? 'login' : 'link';
      await this.rates.check(
        scope + ':ip',
        ip,
        policy === 'login' ? 10 : 5,
        policy === 'login' ? 60_000 : 15 * 60_000,
        response,
      );
      await this.rates.check(
        scope + ':email',
        email,
        policy === 'login' ? 10 : 3,
        policy === 'login' ? 60_000 : 60 * 60_000,
        response,
      );
    }
    return true;
  }
}
