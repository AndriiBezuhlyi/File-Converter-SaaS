import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiKeysService } from './api-keys.service.js';
import { RateLimitService } from '../auth/rate-limit.service.js';

export type ApiRequest = Request & { apiPrincipal?: { kind: 'api'; userId: string } };

// Integration-only boundary. Account and guest controllers use their own session guards.
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly keys: ApiKeysService,
    private readonly rates: RateLimitService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<ApiRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    response.setHeader('Cache-Control', 'no-store');
    await this.rates.check(
      'api:ip',
      request.ip ?? request.socket.remoteAddress ?? 'unknown',
      120,
      60_000,
      response,
    );
    const principal = await this.keys.authenticate(request.headers['x-api-key']);
    await this.rates.check('api:account', principal.userId, 120, 60_000, response);
    request.apiPrincipal = principal;
    return true;
  }
}
