import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { Response } from 'express';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import { bounded } from '../../infrastructure/dependency.js';
import { AUTH_CONFIG, type AuthConfig } from './auth-config.js';
import { AuthError, unavailable } from './auth-error.js';

const increment = `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; return {n,redis.call('PTTL',KEYS[1])}`;
@Injectable()
export class RateLimitService {
  constructor(
    private readonly redis: RedisService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}
  async check(
    scope: string,
    identity: string,
    limit: number,
    windowMs: number,
    response: Response,
  ) {
    const digest = createHmac('sha256', this.config.SESSION_SECRET)
      .update(`rate-limit:${scope}:${identity}`)
      .digest('hex');
    let result: unknown;
    try {
      result = await bounded(
        this.redis.client.eval(increment, {
          keys: [this.redis.rateLimitPrefix + digest],
          arguments: [String(windowMs)],
        }),
        5_000,
      );
    } catch {
      throw unavailable();
    }
    if (!Array.isArray(result) || typeof result[0] !== 'number' || typeof result[1] !== 'number')
      throw unavailable();
    if (result[0] > limit) {
      response.setHeader('Retry-After', Math.max(1, Math.ceil(result[1] / 1000)));
      throw new AuthError(429, 'RATE_LIMITED', 'Too many attempts. Please try again later.');
    }
  }
}
