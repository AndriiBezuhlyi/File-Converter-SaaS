import { validateInfrastructureEnvironment } from './infrastructure-config.js';

describe('infrastructure configuration', () => {
  it('uses bounded local defaults and parses boolean false correctly', () => {
    const config = validateInfrastructureEnvironment({
      NODE_ENV: 'test',
      S3_FORCE_PATH_STYLE: 'false',
    });
    expect(config.S3_FORCE_PATH_STYLE).toBe(false);
    expect(config.DATABASE_POOL_MAX).toBe(5);
    expect(config.SMTP_REQUIRE_TLS).toBe(false);
  });
  it('requires explicit production credentials and TLS without exposing rejected values', () => {
    expect(() => validateInfrastructureEnvironment({ NODE_ENV: 'production' })).toThrow(
      'DATABASE_URL',
    );
    const production = {
      ...validateInfrastructureEnvironment({ NODE_ENV: 'test' }),
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://app:synthetic@db.internal/converter',
      REDIS_URL: 'rediss://:synthetic@cache.internal:6379',
      S3_ENDPOINT: 'https://storage.example.test',
      S3_ACCESS_KEY_ID: 'synthetic-access',
      S3_SECRET_ACCESS_KEY: 'synthetic-secret',
      SMTP_REQUIRE_TLS: true,
    };
    expect(validateInfrastructureEnvironment(production).SMTP_REQUIRE_TLS).toBe(true);
    expect(() =>
      validateInfrastructureEnvironment({ ...production, SMTP_REQUIRE_TLS: false }),
    ).toThrow('SMTP_REQUIRE_TLS');
    expect(() =>
      validateInfrastructureEnvironment({
        ...production,
        S3_ENDPOINT: 'http://storage.example.test',
      }),
    ).toThrow('S3_ENDPOINT');
    for (const key of ['DATABASE_URL', 'REDIS_URL', 'S3_ENDPOINT']) {
      expect(() =>
        validateInfrastructureEnvironment({ NODE_ENV: 'test', [key]: 'private-secret-value' }),
      ).toThrow(key);
      try {
        validateInfrastructureEnvironment({ NODE_ENV: 'test', [key]: 'private-secret-value' });
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain(key);
        expect((error as Error).message).not.toContain('private-secret-value');
      }
    }
  });
  it('rejects unpaired SMTP credentials and unbounded pool sizes', () => {
    expect(() =>
      validateInfrastructureEnvironment({ NODE_ENV: 'test', SMTP_USER: 'user' }),
    ).toThrow('SMTP_PASSWORD');
    expect(() =>
      validateInfrastructureEnvironment({ NODE_ENV: 'test', DATABASE_POOL_MAX: 101 }),
    ).toThrow('DATABASE_POOL_MAX');
  });
});
