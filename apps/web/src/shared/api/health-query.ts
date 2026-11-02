import { queryOptions, useQuery } from '@tanstack/react-query';
import type { HealthClient } from './health-client';

export function readinessQuery(api: HealthClient) {
  return queryOptions({
    queryKey: ['api', api.scope, 'health', 'ready'],
    queryFn: ({ signal }) => api.ready(signal),
    retry: false,
    staleTime: 5_000,
    gcTime: 0,
    refetchInterval: (query) => (query.state.error ? 30_000 : 10_000),
    refetchIntervalInBackground: false,
  });
}

export function useApiReadiness(api: HealthClient) {
  return useQuery(readinessQuery(api));
}
