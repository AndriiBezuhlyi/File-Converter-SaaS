import axios, { type AxiosAdapter, type AxiosResponse } from 'axios';
import { ApiRequestError } from './api-error';
import { downloadName } from './download-name';

export interface CsrfToken {
  headerName: string;
  value: string;
}

interface RequestOptions {
  // Relative API path only; never pass a server-returned download URL here.
  path: string;
  signal?: AbortSignal;
  params?: Readonly<Record<string, string | number | boolean>>;
  statuses?: readonly number[];
}

type JsonRequest<T> = RequestOptions & {
  decode: (data: unknown, status: number) => T;
} & (
    | { method?: 'GET'; body?: never; csrf?: never; onUploadProgress?: never }
    | {
        method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
        body?: unknown;
        // Supplied by an agreed backend handshake. There is deliberately no guessed default.
        csrf: CsrfToken;
        onUploadProgress?: (progress: { loaded: number; total?: number }) => void;
      }
  );

interface DownloadRequest extends Omit<RequestOptions, 'statuses' | 'params'> {
  fallbackName: string;
  contentTypes: readonly (
    'image/png' | 'image/jpeg' | 'image/webp' | 'image/avif' | 'application/pdf'
  )[];
}

export interface HttpClient {
  readonly scope: string;
  json<T>(request: JsonRequest<T>): Promise<T>;
  download(request: DownloadRequest): Promise<{ blob: Blob; name: string }>;
}

function basePath(value: unknown): string {
  if (typeof value !== 'string' || !/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/?$/.test(value))
    throw new ApiRequestError('configuration');
  return value.replace(/\/$/, '');
}

function path(value: string): string {
  if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(value))
    throw new ApiRequestError('configuration');
  return value;
}

function csrfHeaders(request: JsonRequest<unknown>): Record<string, string> {
  if (!request.method || request.method === 'GET') return {};
  const token = request.csrf;
  if (
    !token ||
    typeof token.headerName !== 'string' ||
    !/^[a-zA-Z][a-zA-Z0-9-]{0,63}$/.test(token.headerName) ||
    /^(authorization|cookie|set-cookie|host|origin|referer|content-.+|accept|x-api-key|proxy-.+|sec-.+)$/i.test(
      token.headerName,
    ) ||
    typeof token.value !== 'string' ||
    !token.value ||
    token.value.length > 4_096 ||
    /[\r\n]/.test(token.value)
  )
    throw new ApiRequestError('configuration');
  return { [token.headerName]: token.value };
}

function normalizeError(error: unknown, signal?: AbortSignal): ApiRequestError {
  if (error instanceof ApiRequestError) return error;
  if (signal?.aborted || axios.isCancel(error)) return new ApiRequestError('cancelled');
  if (axios.isAxiosError<unknown, unknown>(error)) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT')
      return new ApiRequestError('timeout');
    if (error.response) return new ApiRequestError('http', error.response.status);
  }
  return new ApiRequestError('network');
}

export function createHttpClient(
  options: { basePath?: string; timeoutMs?: number; adapter?: AxiosAdapter } = {},
): HttpClient {
  const base = basePath(options.basePath ?? import.meta.env.VITE_API_BASE_URL ?? '/api/v1');
  const timeout = options.timeoutMs ?? 30_000;
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 120_000)
    throw new ApiRequestError('configuration');
  const transport = axios.create({
    baseURL: `${base}/`,
    allowAbsoluteUrls: false,
    withCredentials: true,
    // SessionClient supplies the agreed synchronizer token explicitly.
    withXSRFToken: false,
    timeout,
    validateStatus: () => true,
    ...(options.adapter ? { adapter: options.adapter } : {}),
  });

  function checkStatus(response: AxiosResponse<unknown>, accepted: readonly number[]) {
    if (!accepted.includes(response.status)) {
      const data = response.data;
      const error = data && typeof data === 'object' && 'error' in data ? data.error : null;
      const code =
        error &&
        typeof error === 'object' &&
        'code' in error &&
        typeof error.code === 'string' &&
        /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
          ? error.code
          : undefined;
      throw new ApiRequestError('http', response.status, code);
    }
  }

  return {
    scope: base,
    async json<T>(request: JsonRequest<T>): Promise<T> {
      try {
        const response = await transport.request<unknown, AxiosResponse<unknown>, unknown>({
          url: path(request.path),
          method: request.method ?? 'GET',
          headers: { Accept: 'application/json', ...csrfHeaders(request) },
          ...(request.body !== undefined ? { data: request.body } : {}),
          ...(request.signal ? { signal: request.signal } : {}),
          ...(request.params ? { params: request.params } : {}),
          ...(request.onUploadProgress
            ? {
                onUploadProgress: ({ loaded, total }) => {
                  request.onUploadProgress?.({ loaded, ...(total !== undefined ? { total } : {}) });
                },
              }
            : {}),
          responseType: 'json',
        });
        checkStatus(response, request.statuses ?? [200]);
        try {
          return request.decode(response.data, response.status);
        } catch {
          throw new ApiRequestError('invalid-response', response.status);
        }
      } catch (error) {
        throw normalizeError(error, request.signal);
      }
    },
    async download(request: DownloadRequest) {
      try {
        const response = await transport.request<unknown, AxiosResponse<unknown>, never>({
          url: path(request.path),
          method: 'GET',
          headers: { Accept: request.contentTypes.join(', ') },
          ...(request.signal ? { signal: request.signal } : {}),
          responseType: 'blob',
        });
        checkStatus(response, [200]);
        const contentType: unknown = response.headers['content-type'];
        const mime = typeof contentType === 'string' ? contentType.split(';')[0]?.trim() : '';
        if (
          !(response.data instanceof Blob) ||
          !response.data.size ||
          !request.contentTypes.some((allowed) => allowed === mime)
        )
          throw new ApiRequestError('invalid-response', response.status);
        return {
          blob: response.data,
          name: downloadName(response.headers['content-disposition'], request.fallbackName),
        };
      } catch (error) {
        throw normalizeError(error, request.signal);
      }
    },
  };
}
