import { z } from 'zod';
import type { components } from '@converter/contracts';
import { ApiRequestError } from '../../../shared/api/api-error';
import { sessionSchema, type SessionClient } from '../../../shared/api/session-client';
import {
  ConversionRequestError,
  type ConversionGateway,
  type ConversionJob,
} from './conversion-gateway';

const summary = z.object({
  id: z.string().uuid(),
  sourceFormat: z.enum(['jpg', 'png', 'docx']),
  targetFormat: z.enum(['jpg', 'png', 'pdf']),
  createdAt: z.string(),
  saveResult: z.boolean(),
});
const accepted: z.ZodType<components['schemas']['ConversionAccepted']> = summary.extend({
  status: z.literal('queued'),
});
const statusSchema: z.ZodType<components['schemas']['ConversionStatus']> = summary.extend({
  status: z.enum(['queued', 'processing', 'completed', 'failed']),
  completedAt: z.string().nullable(),
  error: z.object({ code: z.literal('CONVERSION_FAILED'), message: z.string() }).nullable(),
  resultAvailability: z.enum(['pending', 'available', 'expired', 'deleted', 'unavailable']),
  result: z
    .object({
      id: z.string().uuid(),
      owner: z.enum(['guest', 'account']),
      name: z.string(),
      format: z.enum(['jpg', 'png', 'pdf']),
      sizeBytes: z.number().positive(),
      retention: z.enum(['temporary', 'saved']),
      expiresAt: z.string().nullable(),
      availability: z.enum(['pending', 'available', 'expired', 'deleted']),
    })
    .nullable(),
});
const guestSchema: z.ZodType<components['schemas']['GuestSession']> = z.object({
  trialState: z.enum(['available', 'reserved', 'consumed']),
  activeConversionId: z.string().uuid().nullable(),
});

function mapJob(job: components['schemas']['ConversionStatus']): ConversionJob {
  const common = {
    id: job.id,
    sourceName: null,
    sourceFormat: job.sourceFormat,
    targetFormat: job.targetFormat,
  };
  if (job.status === 'failed') return { ...common, status: 'failed', reason: 'unknown' };
  if (job.status !== 'completed') return { ...common, status: job.status };
  const result = job.result;
  if (
    !result ||
    result.availability === 'pending' ||
    (result.retention === 'temporary' && !result.expiresAt)
  )
    throw new ConversionRequestError('network');
  return {
    ...common,
    status: 'completed',
    result: {
      name: result.name,
      format: result.format,
      sizeBytes: result.sizeBytes,
      // Ownership is used only for presentation; the server authorizes every download.
      owner: result.owner,
      availability: result.availability,
      retention:
        result.retention === 'saved'
          ? { kind: 'saved' }
          : { kind: 'temporary', expiresAt: result.expiresAt! },
    },
  };
}
function requestError(error: unknown): never {
  if (error instanceof ConversionRequestError) throw error;
  if (error instanceof ApiRequestError) {
    if (error.status === 401 && error.code === 'GUEST_CREDENTIAL_INVALID')
      throw new ConversionRequestError('guest-session-invalid');
    if (error.status === 404) throw new ConversionRequestError('not-found');
    if (error.status === 410) throw new ConversionRequestError('expired');
    if (error.status === 401 || error.status === 403) throw new ConversionRequestError('forbidden');
  }
  throw new ConversionRequestError('network');
}

export function createConversionGateway(
  client: SessionClient,
  identity: string,
): ConversionGateway {
  // Deduplicate the guest bootstrap across StrictMode and simultaneous eligibility reads.
  let bootstrap: Promise<components['schemas']['GuestSession']> | undefined;
  return {
    scope: `${client.http.scope}:${identity}`,
    async readAccess(signal) {
      try {
        const session = await client.http.json({
          path: 'auth/session',
          signal,
          decode: (value) => sessionSchema.parse(value),
        });
        if (session.kind === 'authenticated') return { kind: 'account', jobId: null };
        bootstrap ??= client.mutate('guest-session', 'POST', {}, (value) =>
          guestSchema.parse(value),
        );
        let guest;
        try {
          guest = await bootstrap;
        } finally {
          bootstrap = undefined;
        }
        return { kind: 'guest', trial: guest.trialState, jobId: guest.activeConversionId };
      } catch (error) {
        return requestError(error);
      }
    },
    async submit(selection, onProgress, signal) {
      try {
        const token = await client.http.json({
          path: 'auth/csrf',
          ...(signal ? { signal } : {}),
          decode: (value) => z.object({ csrfToken: z.string() }).parse(value),
        });
        const body = new FormData();
        body.append('file', selection.file);
        body.append('targetFormat', selection.targetFormat);
        const job = await client.http.json({
          path: 'conversions',
          ...(signal ? { signal } : {}),
          method: 'POST',
          body,
          csrf: { headerName: 'X-CSRF-Token', value: token.csrfToken },
          onUploadProgress: onProgress,
          statuses: [202],
          decode: (value) => accepted.parse(value),
        });
        return { kind: 'accepted', job: { ...job, sourceName: selection.file.name } };
      } catch (error) {
        if (error instanceof ApiRequestError) {
          if (error.status === 401) return { kind: 'sign-in-required' };
          if (error.status === 429) return { kind: 'rejected', reason: 'rate-limit' };
          if (
            error.status === 400 ||
            error.status === 413 ||
            error.status === 415 ||
            error.status === 422
          )
            return { kind: 'rejected', reason: 'invalid-file' };
          if (error.status === 409 && error.code === 'GUEST_CONVERSION_IN_PROGRESS') {
            bootstrap = undefined;
            const access = await this.readAccess(new AbortController().signal);
            if (access.jobId) return { kind: 'active', jobId: access.jobId };
          }
        }
        return { kind: 'unknown' };
      }
    },
    async readJob(id, signal) {
      try {
        return mapJob(
          await client.http.json({
            path: `conversions/${id}`,
            signal,
            decode: (value) => statusSchema.parse(value),
          }),
        );
      } catch (error) {
        return requestError(error);
      }
    },
    async download(id) {
      try {
        return await client.http.download({
          path: `conversions/${id}/download`,
          fallbackName: 'conversion',
          contentTypes: ['image/jpeg', 'image/png', 'application/pdf'],
        });
      } catch (error) {
        return requestError(error);
      }
    },
  };
}
