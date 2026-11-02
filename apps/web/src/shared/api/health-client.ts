import type { components, operations, paths } from '@converter/contracts';
import { createHttpClient, type HttpClient } from './http-client';

export type Readiness = components['schemas']['Readiness'];
export type Liveness = operations['healthLive']['responses'][200]['content']['application/json'];

// Paths are checked against the generated contract; the transport adds the configured API prefix.
const endpoints = {
  live: '/api/v1/health/live',
  ready: '/api/v1/health/ready',
} as const satisfies Record<string, keyof paths>;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function decodeReadiness(data: unknown, status: number): Readiness {
  if (
    !record(data) ||
    !record(data.dependencies) ||
    (data.status !== 'ok' && data.status !== 'unavailable') ||
    (status === 200 ? data.status !== 'ok' : data.status !== 'unavailable')
  )
    throw new Error('Invalid readiness response.');
  const dependencies: Readiness['dependencies'] = {};
  for (const [name, state] of Object.entries(data.dependencies)) {
    if (state !== 'up' && state !== 'down') throw new Error('Invalid readiness response.');
    Object.defineProperty(dependencies, name, { value: state, enumerable: true });
  }
  return { status: data.status, dependencies };
}

export function createHealthClient(http: HttpClient = createHttpClient()) {
  return {
    scope: http.scope,
    live(signal?: AbortSignal) {
      return http.json<Liveness>({
        path: endpoints.live.slice('/api/v1/'.length),
        ...(signal ? { signal } : {}),
        decode(data) {
          if (!record(data) || data.status !== 'ok') throw new Error('Invalid liveness response.');
          return { status: 'ok' };
        },
      });
    },
    ready(signal?: AbortSignal) {
      return http.json<Readiness>({
        path: endpoints.ready.slice('/api/v1/'.length),
        statuses: [200, 503],
        ...(signal ? { signal } : {}),
        decode: decodeReadiness,
      });
    },
  };
}

export type HealthClient = ReturnType<typeof createHealthClient>;
