export type ApiErrorKind =
  'configuration' | 'cancelled' | 'timeout' | 'network' | 'http' | 'invalid-response';

// Never retain Axios config, bodies, headers, URLs or the original exception in query caches.
export class ApiRequestError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    readonly status?: number,
  ) {
    super('The API request could not be completed.');
    this.name = 'ApiRequestError';
  }
}
