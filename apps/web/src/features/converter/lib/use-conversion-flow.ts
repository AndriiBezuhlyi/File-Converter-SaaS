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

export function useConversionFlow(
  gateway: ConversionGateway,
  requestedId: string | null,
  onJobId: (id: string | null) => void,
) {
  const client = useQueryClient();
  const accessKey = ['converter', gateway.scope, 'access'] as const;
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [stage, setStage] = useState<'checking' | 'uploading'>('checking');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [outcome, setOutcome] = useState<SubmissionOutcome | null>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [selectionVersion, setSelectionVersion] = useState(0);
  const submitting = useRef(false);
  const attempt = useRef(0);
  const mounted = useRef(false);
  const terminalSeen = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const access = useQuery({
    queryKey: accessKey,
    queryFn: ({ signal }) => gateway.readAccess(signal),
    retry: false,
    staleTime: 0,
  });
  const recoveredId = access.data?.jobId === dismissedId ? null : (access.data?.jobId ?? null);
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
      return query.state.error ? 30_000 : 2_000;
    },
    refetchOnWindowFocus: (query) => !isTerminal(query.state.data),
    refetchOnReconnect: (query) => !isTerminal(query.state.data),
  });

  useEffect(() => {
    const current = job.data;
    if (!current || !isTerminal(current) || terminalSeen.current === current.id) return;
    terminalSeen.current = current.id;
    // Eligibility is server state: success/failure never edits a local trial counter.
    void client.invalidateQueries({ queryKey: ['converter', gateway.scope, 'access'] });
    if (current.status === 'completed' && current.result.retention.kind === 'saved') {
      void client.invalidateQueries({ queryKey: ['files'] });
    }
  }, [client, gateway.scope, job.data]);

  const upload = useMutation({
    retry: false,
    mutationFn: async (selection: FileSelection): Promise<SubmissionOutcome> => {
      const currentAttempt = attempt.current;
      // Recheck before transmitting any file bytes; the backend still enforces the atomic reservation.
      const current = await client.fetchQuery({
        queryKey: accessKey,
        queryFn: ({ signal }) => gateway.readAccess(signal),
        staleTime: 0,
      });
      if (current.kind === 'guest' && current.trial === 'consumed')
        return { kind: 'sign-in-required' };
      if (current.kind === 'guest' && current.trial === 'reserved') {
        return isJobId(current.jobId)
          ? { kind: 'active', jobId: current.jobId }
          : { kind: 'unknown' };
      }
      setStage('uploading');
      try {
        const result = await gateway.submit(selection, (next) => {
          if (!mounted.current || !submitting.current || attempt.current !== currentAttempt) return;
          setProgress(next);
        });
        if (result.kind === 'accepted' && !isJobId(result.job.id)) return { kind: 'unknown' };
        return result;
      } catch {
        // A lost POST response may conceal acceptance. Never replay it automatically.
        return { kind: 'unknown' };
      }
    },
    onSuccess: (result) => {
      if (result.kind === 'accepted') {
        client.setQueryData(['converter', gateway.scope, 'job', result.job.id], result.job);
      }
      if (!mounted.current) return;
      setOutcome(result);
      if (result.kind === 'accepted') onJobId(result.job.id);
      if (result.kind === 'active' && isJobId(result.jobId)) onJobId(result.jobId);
      if (result.kind === 'sign-in-required') setDialogOpen(true);
      void client.invalidateQueries({ queryKey: accessKey });
    },
    onSettled: () => {
      submitting.current = false;
    },
  });

  function submit(selection: FileSelection) {
    if (submitting.current || outcome?.kind === 'unknown' || (jobId && !isTerminal(job.data)))
      return;
    if (access.data?.kind === 'guest' && access.data.trial === 'consumed') {
      setDialogOpen(true);
      return;
    }
    submitting.current = true;
    attempt.current += 1;
    setStage('checking');
    setProgress(null);
    setOutcome(null);
    upload.mutate(selection);
  }

  function nextFile() {
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
    onJobId(null);
    setOutcome(null);
    upload.reset();
  }

  return {
    access,
    job,
    jobId,
    upload,
    progress,
    stage,
    outcome,
    submit,
    nextFile,
    dialogOpen,
    selectionVersion,
    closeDialog: () => setDialogOpen(false),
  };
}
