import { describe, expect, it } from 'vitest';
import {
  isJobId,
  isResultExpired,
  uploadPercent,
  type ConversionResult,
} from './conversion-gateway';

describe('conversion view policy', () => {
  it('uses measured bytes only, including unknown totals and boundaries', () => {
    expect(uploadPercent({ loaded: 48, total: 100 })).toBe(48);
    expect(uploadPercent({ loaded: 99, total: 100 })).toBe(99);
    expect(uploadPercent({ loaded: 101, total: 100 })).toBe(100);
    expect(uploadPercent({ loaded: 0, total: 100 })).toBe(0);
    for (const progress of [
      null,
      { loaded: 48 },
      { loaded: 48, total: 0 },
      { loaded: -1, total: 100 },
      { loaded: Infinity, total: 100 },
      { loaded: 50, total: Infinity },
    ]) {
      expect(uploadPercent(progress)).toBeUndefined();
    }
  });
  it('expires at the server deadline and fails closed for invalid dates or unavailable results', () => {
    const deadline = '2026-10-22T19:00:00Z';
    const result: ConversionResult = {
      name: null,
      sizeBytes: null,
      format: 'png',
      owner: 'guest',
      retention: { kind: 'temporary', expiresAt: deadline },
      availability: 'available',
    };
    expect(isResultExpired(result, Date.parse(deadline) - 1)).toBe(false);
    expect(isResultExpired(result, Date.parse(deadline))).toBe(true);
    expect(
      isResultExpired({ ...result, retention: { kind: 'temporary', expiresAt: 'invalid' } }, 0),
    ).toBe(true);
    expect(
      isResultExpired({ ...result, retention: { kind: 'saved' } }, Number.MAX_SAFE_INTEGER),
    ).toBe(false);
    expect(
      isResultExpired({ ...result, availability: 'deleted', retention: { kind: 'saved' } }, 0),
    ).toBe(true);
  });
  it('accepts only opaque bounded job IDs in route state', () => {
    expect(isJobId('conversion_123-abc')).toBe(true);
    for (const value of [null, '', '../result', 'https://example.com/key', 'a'.repeat(129)])
      expect(isJobId(value)).toBe(false);
  });
});
