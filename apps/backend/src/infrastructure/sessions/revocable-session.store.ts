import { RedisStore } from 'connect-redis';
import type { SessionData } from 'express-session';
import type { RedisService } from '../redis/redis.service.js';
import { bounded } from '../dependency.js';

type Callback = (error?: unknown) => void;
// Tombstones prevent an in-flight request from recreating a logged-out or rotated SID.
const save = `if redis.call('EXISTS',KEYS[2])==1 then return 0 end; redis.call('SET',KEYS[1],ARGV[1],'EX',ARGV[2]); return 1`;
const revoke = `redis.call('SET',KEYS[2],'1','EX',604800); redis.call('DEL',KEYS[1]); return 1`;
export class RevocableSessionStore extends RedisStore {
  constructor(
    private readonly redis: RedisService,
    ttl: (session: SessionData) => number,
  ) {
    super({ client: redis.client, prefix: redis.sessionPrefix, disableTouch: true, ttl });
  }
  override async get(sid: string, callback?: (error?: unknown, data?: SessionData | null) => void) {
    try {
      const value = await bounded(this.redis.client.get(this.prefix + sid), 5_000);
      callback?.(undefined, value ? (JSON.parse(value) as SessionData) : null);
    } catch {
      callback?.(new Error('Session retrieval unavailable.'));
    }
  }
  override async set(sid: string, data: SessionData, callback?: Callback) {
    try {
      const ttl = typeof this.ttl === 'function' ? this.ttl(data) : this.ttl;
      const result = await bounded(
        this.redis.client.eval(save, {
          keys: [this.prefix + sid, this.prefix + 'revoked:' + sid],
          arguments: [JSON.stringify(data), String(ttl)],
        }),
        5_000,
      );
      if (result !== 1) throw new Error('Session no longer active.');
      callback?.();
    } catch {
      callback?.(new Error('Session persistence unavailable.'));
    }
  }
  override async destroy(sid: string, callback?: Callback) {
    try {
      await bounded(
        this.redis.client.eval(revoke, {
          keys: [this.prefix + sid, this.prefix + 'revoked:' + sid],
          arguments: [],
        }),
        5_000,
      );
      callback?.();
    } catch {
      callback?.(new Error('Session revocation unavailable.'));
    }
  }
}
