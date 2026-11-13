import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ConversionRequestError,
  isJobId,
  isTerminal,
  type ConversionGateway,
  type SubmissionOutcome,
  type UploadProgress,
} from './conversion-gateway';
import type { FileSelection } from './file-selection';
import { useConverterDraft } from './converter-draft-context';
import { useAuth } from '../../auth/lib/auth-context';

export function useConversionFlow(
  gateway: ConversionGateway,
  requestedId: string | null,
  onJobId: (id: string | null) => void,
) {
  const client = useQueryClient();
  const { clear: clearDraft, bindJob, completeJob, isCurrent } = useConverterDraft() ?? {};
  const { gateway: authGateway, session } = useAuth();
  const expectedIdentity = session?.kind === 'authenticated' ? session.email : 'anonymous';
  const accessKey = ['converter', gateway.scope, 'access'] as const;
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [stage, setStage] = useState<'checking' | 'uploading'>('checking');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [outcome, setOutcome] = useState<SubmissionOutcome | null>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [selectionVersion, setSelectionVersion] = useState(0);
  const [selectionName, setSelectionName] = useState<string | null>(null);
  const attemptSelection = useRef<FileSelection | null>(null);
  const submitting = useRef(false);
  const attempt = useRef(0);
  const mounted = useRef(false);
  const terminalSeen = useRef<string | null>(null);
  const uploadController = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      uploadController.current?.abort();
      attemptSelection.current = null;
    };
  }, []);

  const access = useQuery({
    queryKey: accessKey,
    queryFn: ({ signal }) => gateway.readAccess(signal),
    retry: false,
    staleTime: 0,
  });
  const recoveredId = access.data?.jobId === dismissedId ? null : (access.data?.jobId ?? null);
  useEffect(() => {
    if (
      access.error instanceof ConversionRequestError &&
      ['guest-session-invalid', 'forbidden'].includes(access.error.kind)
    )
      clearDraft?.();
  }, [access.error, clearDraft]);
  const jobId = isJobId(requestedId) ? requestedId : isJobId(recoveredId) ? recoveredId : null;
  useEffect(() => {
    if (jobId && !isJobId(requestedId)) onJobId(jobId);
  }, [jobId, requestedId, onJobId]);
  const job = useQuery({
    queryKey: ['converter', gateway.scope, 'job', jobId],
    queryFn: async ({ signal }) => {
      const result = await gateway.readJob(jobId!, signal);
      if (result.id !== jobId) throw new ConversionRequestError('not-found');
      return result;
    },
    enabled: jobId !== null,
    retry: false,
    refetchInterval: (query) => {
      if (isTerminal(query.state.data)) return false;
      if (
        query.state.error instanceof ConversionRequestError &&
        query.state.error.kind !== 'network'
      )
        return false;
      return query.state.error ? 30_000 : 1_500;
    },
    refetchOnWindowFocus: (query) => !isTerminal(query.state.data),
    refetchOnReconnect: (query) => !isTerminal(query.state.data),
  });

  useEffect(() => {
    const current = job.data;
    if (current?.status === 'completed') completeJob?.(current.id);
    if (!current || !isTerminal(current) || terminalSeen.current === current.id) return;
    terminalSeen.current = current.id;
    // Eligibility is server state: success/failure never edits a local trial counter.
    void client.invalidateQueries({ queryKey: ['converter', gateway.scope, 'access'] });
    if (current.status === 'completed' && current.result.retention.kind === 'saved') {
      void client.invalidateQueries({ queryKey: ['files'] });
    }
  }, [client, gateway.scope, job.data, completeJob]);

  const upload = useMutation({
    retry: false,
    mutationFn: async (): Promise<SubmissionOutcome> => {
      const selection = attemptSelection.current;
      if (!selection) throw new Error('No active selection.');
      const currentAttempt = attempt.current;
      if (authGateway) {
        const checked = await client.fetchQuery({
          queryKey: ['auth', authGateway.scope, 'session'],
          queryFn: ({ signal }) => authGateway.readSession(signal),
          staleTime: 0,
        });
        const identity = checked.kind === 'authenticated' ? checked.email : 'anonymous';
        if (identity !== expectedIdentity) {
          clearDraft?.();
          throw new ConversionRequestError('forbidden');
        }
        if (!mounted.current || uploadController.current?.signal.aborted)
          return { kind: 'unknown' };
      }
      // Recheck before transmitting any file bytes; the backend still enforces the atomic reservation.
      const current = await client.fetchQuery({
        queryKey: accessKey,
        queryFn: ({ signal }) => gateway.readAccess(signal),
        staleTime: 0,
      });
      if (!mounted.current || uploadController.current?.signal.aborted) return { kind: 'unknown' };
      if (current.kind === 'guest' && current.trial === 'consumed')
        return { kind: 'sign-in-required' };
      if (current.kind === 'guest' && current.trial === 'reserved') {
        return isJobId(current.jobId)
          ? { kind: 'active', jobId: current.jobId }
          : { kind: 'unknown' };
      }
      setStage('uploading');
      try {
        const result = await gateway.submit(
          selection,
          (next) => {
            if (!mounted.current || !submitting.current || attempt.current !== currentAttempt)
              return;
            setProgress(next);
          },
          uploadController.current?.signal,
        );
        if (!mounted.current) return { kind: 'unknown' };
        if (result.kind === 'accepted' && !isJobId(result.job.id)) return { kind: 'unknown' };
        if (result.kind === 'accepted') {
          bindJob?.(selection, result.job.id);
          if (result.job.status === 'completed') completeJob?.(result.job.id);
        }
        return result;
      } catch {
        // A lost POST response may conceal acceptance. Never replay it automatically.
        return { kind: 'unknown' };
      }
    },
    onSuccess: (result) => {
      // Hook-level mutation callbacks can outlive an identity remount.
      if (!mounted.current) return;
      if (result.kind === 'accepted') {
        client.setQueryData(['converter', gateway.scope, 'job', result.job.id], result.job);
      }
      setOutcome(result);
      if (result.kind === 'accepted') onJobId(result.job.id);
      if (result.kind === 'active' && isJobId(result.jobId)) onJobId(result.jobId);
      if (result.kind === 'sign-in-required') setDialogOpen(true);
      void client.invalidateQueries({ queryKey: accessKey });
    },
    onSettled: () => {
      submitting.current = false;
      uploadController.current = null;
      attemptSelection.current = null;
    },
  });

  function submit(selection: FileSelection) {
    if (isCurrent && !isCurrent(selection)) return;
    if (submitting.current || outcome?.kind === 'unknown' || (jobId && !isTerminal(job.data)))
      return;
    if (access.data?.kind === 'guest' && access.data.trial === 'consumed') {
      setDialogOpen(true);
      return;
    }
    submitting.current = true;
    uploadController.current = new AbortController();
    attempt.current += 1;
    setStage('checking');
    setProgress(null);
    setOutcome(null);
    attemptSelection.current = selection;
    setSelectionName(selection.file.name);
    upload.mutate();
  }

  function nextFile(keepSelection = false) {
    if (access.data?.kind === 'guest' && access.data.trial === 'consumed') {
      setDialogOpen(true);
      return;
    }
    if (access.isError || access.isFetching) return;
    if (access.data?.kind === 'guest' && access.data.trial === 'reserved') {
      if (isJobId(access.data.jobId)) onJobId(access.data.jobId);
      return;
    }
    // Forget only the current view, not the server's quota or guest credential.
    setDismissedId(jobId);
    setSelectionVersion((version) => version + 1);
    if (!keepSelection) clearDraft?.();
    onJobId(null);
    setOutcome(null);
    upload.reset();
  }

  return {
    selectionChanged: () => {
      // Only admission errors tied to the selected bytes/target become stale.
      if (
        outcome?.kind === 'rejected' &&
        ['invalid-file', 'animated-gif', 'animated-webp', 'animated-avif'].includes(outcome.reason)
      )
        setOutcome(null);
    },
    access,
    job,
    jobId,
    upload,
    progress,
    stage,
    outcome,
    submit,
    nextFile: () => nextFile(),
    retrySelection: () => nextFile(true),
    dialogOpen,
    selectionVersion,
    selectionName,
    closeDialog: () => setDialogOpen(false),
  };
}
