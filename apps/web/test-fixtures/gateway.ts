import {
  ConversionRequestError,
  type ConversionAccess,
  type ConversionGateway,
  type ConversionJob,
  type ConversionResult,
  type SubmissionOutcome,
  type UploadProgress,
} from '../src/features/converter/lib/conversion-gateway';
import type { FileSelection } from '../src/features/converter/lib/file-selection';
import pngUrl from './assets/example.png?url';
import jpgUrl from './assets/example.jpg?url';
import pdfUrl from './assets/example.pdf?url';

const outputs = {
  png: { url: pngUrl, name: 'example.png', sizeBytes: 90 },
  jpg: { url: jpgUrl, name: 'example.jpg', sizeBytes: 268 },
  pdf: { url: pdfUrl, name: 'example.pdf', sizeBytes: 591 },
} as const;

export type Scenario =
  | 'success'
  | 'failed'
  | 'failed-once'
  | 'connection'
  | 'unknown'
  | 'expired'
  | 'saved'
  | 'reserved'
  | 'consumed'
  | 'download-error'
  | 'download-expired'
  | 'unmeasured'
  | 'rejected';
const scenarios: readonly string[] = [
  'success',
  'failed',
  'failed-once',
  'connection',
  'unknown',
  'expired',
  'saved',
  'reserved',
  'consumed',
  'download-error',
  'download-expired',
  'unmeasured',
  'rejected',
];
export function getScenario(value: string | null): Scenario {
  return scenarios.includes(value ?? '') ? (value as Scenario) : 'success';
}

export function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const abort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

// Controlled test responses only. This module is never imported by the production entry.
export class FixtureGateway implements ConversionGateway {
  readonly scope: string;
  submissions = 0;
  statusReads = 0;
  downloads = 0;
  accessReads = 0;
  private phase = 0;
  private trial: 'available' | 'reserved' | 'consumed' = 'available';
  private jobId: string | null = null;
  private sourceName: string | null = null;
  private sourceFormat: FileSelection['sourceFormat'] = 'jpg';
  private targetFormat: FileSelection['targetFormat'] = 'png';
  private result: ConversionResult | null = null;

  constructor(
    readonly scenario: Scenario,
    resumedId: string | null = null,
    private readonly isAuthenticated: () => boolean = () => false,
  ) {
    this.scope = `fixture-${scenario}`;
    if (resumedId || ['reserved', 'consumed', 'expired'].includes(scenario)) {
      this.jobId = resumedId ?? 'fixture_job';
      this.trial = scenario === 'consumed' || scenario === 'expired' ? 'consumed' : 'reserved';
      if (this.trial === 'consumed') this.finish();
    }
  }

  async readAccess(signal: AbortSignal): Promise<ConversionAccess> {
    await wait(20, signal);
    this.accessReads += 1;
    return this.scenario === 'saved' || this.isAuthenticated()
      ? { kind: 'account', jobId: this.jobId }
      : { kind: 'guest', trial: this.trial, jobId: this.jobId };
  }

  async submit(
    selection: FileSelection,
    onProgress: (progress: UploadProgress) => void,
  ): Promise<SubmissionOutcome> {
    this.submissions += 1;
    this.phase = 0;
    this.result = null;
    this.sourceName = selection.file.name;
    this.sourceFormat = selection.sourceFormat;
    this.targetFormat = selection.targetFormat;
    // Known synthetic outputs exercise every MVP direction without simulating conversion engines.
    if (this.scenario === 'rejected') return { kind: 'rejected', reason: 'invalid-file' };
    onProgress(this.scenario === 'unmeasured' ? { loaded: 48 } : { loaded: 48, total: 100 });
    await wait(700);
    onProgress(this.scenario === 'unmeasured' ? { loaded: 100 } : { loaded: 100, total: 100 });
    await wait(700);
    if (this.scenario === 'unknown') return { kind: 'unknown' };
    this.jobId = this.submissions === 1 ? 'fixture_job' : `fixture_job_${this.submissions}`;
    this.trial = 'reserved';
    return { kind: 'accepted', job: this.summary('queued') };
  }

  async readJob(id: string, signal: AbortSignal): Promise<ConversionJob> {
    await wait(20, signal);
    this.statusReads += 1;
    if (id !== this.jobId) throw new ConversionRequestError('not-found');
    if (this.scenario === 'connection' && this.statusReads === 1)
      throw new ConversionRequestError('network');
    if (this.result)
      return { ...this.summary('completed'), status: 'completed', result: this.result };
    this.phase += 1;
    if (this.phase < 3) return this.summary(this.phase === 1 ? 'queued' : 'processing');
    if (this.scenario === 'failed' || (this.scenario === 'failed-once' && this.submissions === 1)) {
      this.trial = 'available';
      return { ...this.summary('failed'), status: 'failed', reason: 'invalid-file' };
    }
    this.finish();
    return { ...this.summary('completed'), status: 'completed', result: this.result! };
  }

  async download(): Promise<{ blob: Blob; name: string }> {
    await wait(20);
    this.downloads += 1;
    if (this.scenario === 'download-error' && this.downloads === 1)
      throw new ConversionRequestError('network');
    // Expiry discovered during download, after available result metadata was displayed.
    if (this.scenario === 'download-expired') throw new ConversionRequestError('expired');
    if (!this.result || this.result.availability !== 'available')
      throw new ConversionRequestError('expired');
    const output = outputs[this.targetFormat];
    const response = await fetch(output.url);
    if (!response.ok) throw new ConversionRequestError('network');
    return { blob: await response.blob(), name: output.name };
  }

  private summary<T extends ConversionJob['status']>(status: T) {
    return {
      id: this.jobId ?? 'fixture_job',
      status,
      sourceName: this.sourceName,
      sourceFormat: this.sourceFormat,
      targetFormat: this.targetFormat,
    };
  }

  private finish() {
    this.trial = 'consumed';
    const output = outputs[this.targetFormat];
    this.result = {
      name: output.name,
      sizeBytes: output.sizeBytes,
      format: this.targetFormat,
      owner: this.scenario === 'saved' || this.isAuthenticated() ? 'account' : 'guest',
      retention:
        this.scenario === 'saved' || this.isAuthenticated()
          ? { kind: 'saved' }
          : {
              kind: 'temporary',
              expiresAt: new Date(
                Date.now() + (this.scenario === 'expired' ? -1_000 : 3_600_000),
              ).toISOString(),
            },
      availability: this.scenario === 'expired' ? 'expired' : 'available',
    };
  }
}
