import { validateEnvironment } from './environment.js';

describe('runtime configuration', () => {
  it('coerces a valid port without requiring external services', () => {
    expect(validateEnvironment({ NODE_ENV: 'test', API_PORT: '3100' }).API_PORT).toBe(3100);
  });
  it.each(['0', '65536', 'not-a-port'])('rejects invalid API_PORT %s', (API_PORT) => {
    expect(() => validateEnvironment({ API_PORT })).toThrow('API_PORT');
  });
  it('does not include rejected input values in diagnostics', () => {
    expect(() => validateEnvironment({ NODE_ENV: 'sensitive-input-value' })).toThrow(
      'Invalid environment variables: NODE_ENV',
    );
  });
});
