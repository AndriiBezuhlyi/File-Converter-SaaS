import type { FileSelection, SourceFormat, TargetFormat } from './file-selection';

// Frontend view models, not HTTP DTOs. Item 8 maps the generated contract to this port.
// No transport is enabled until the guest/auth contract and real endpoints exist.
export type ConversionAccess =
  | { kind: 'account'; jobId: string | null }
  | { kind: 'guest'; trial: 'available' | 'reserved' | 'consumed'; jobId: string | null };

interface JobSummary {
  id: string;
  sourceName: string | null;
  sourceFormat: SourceFormat;
  targetFormat: TargetFormat;
}

export interface ConversionResult {
  name: string | null;
  sizeBytes: number | null;
  format: TargetFormat;
  owner: 'guest' | 'account';
  retention: { kind: 'temporary'; expiresAt: string } | { kind: 'saved' };
  availability: 'available' | 'expired' | 'deleted';
}

export type ConversionJob = JobSummary &
  (
    | { status: 'queued' | 'processing' }
    | { status: 'failed'; reason: 'invalid-file' | 'unavailable' | 'unknown' }
    | { status: 'completed'; result: ConversionResult }
  );

export interface UploadProgress {
  loaded: number;
  total?: number;
}

export type SubmissionOutcome =
  | { kind: 'accepted'; job: ConversionJob }
  | { kind: 'active'; jobId: string }
  | { kind: 'sign-in-required' }
  | { kind: 'rejected'; reason: 'invalid-file' | 'rate-limit' | 'unavailable' }
  | { kind: 'unknown' };

export class ConversionRequestError extends Error {
  constructor(public readonly kind: 'network' | 'not-found' | 'expired' | 'forbidden') {
    super('Conversion request could not be completed.');
    this.name = 'ConversionRequestError';
  }
}

export interface ConversionGateway {
  // Stable cache namespace; never a cookie, API key, or other credential.
  readonly scope: string;
  readAccess(signal: AbortSignal): Promise<ConversionAccess>;
  submit(
    selection: FileSelection,
    onProgress: (progress: UploadProgress) => void,
  ): Promise<SubmissionOutcome>;
  readJob(id: string, signal: AbortSignal): Promise<ConversionJob>;
  download(id: string): Promise<{ blob: Blob; name: string }>;
}

export function uploadPercent(progress: UploadProgress | null): number | undefined {
  if (
    !progress ||
    !Number.isFinite(progress.loaded) ||
    progress.loaded < 0 ||
    !progress.total ||
    !Number.isFinite(progress.total) ||
    progress.total <= 0
  )
    return undefined;
  return Math.min(100, Math.floor((progress.loaded / progress.total) * 100));
}

export function isTerminal(job: ConversionJob | undefined): boolean {
  return job?.status === 'completed' || job?.status === 'failed';
}

export function isResultExpired(result: ConversionResult, now: number): boolean {
  if (result.availability !== 'available') return true;
  if (result.retention.kind === 'saved') return false;
  const deadline = Date.parse(result.retention.expiresAt);
  return !Number.isFinite(deadline) || deadline <= now;
}

export function isJobId(value: string | null): value is string {
  return value !== null && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}
