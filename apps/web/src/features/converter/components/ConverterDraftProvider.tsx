import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { useAuth } from '../../auth/lib/auth-context';
import { ConverterDraftContext } from '../lib/converter-draft-context';
import type { FileSelection } from '../lib/file-selection';

const DRAFT_IDLE_MS = 30 * 60_000;
interface DraftRecord {
  selection: FileSelection;
  deadline: number;
  jobId: string | null;
}

export function ConverterDraftProvider({ children }: PropsWithChildren) {
  const { session, status, gateway, sessionExpiresAt } = useAuth();
  const identity =
    status === 'error'
      ? 'invalid'
      : session?.kind === 'authenticated'
        ? session.email
        : 'anonymous';
  const expiresAt =
    session?.kind === 'authenticated' ? (sessionExpiresAt ?? gateway?.sessionExpiresAt) : undefined;
  return (
    <DraftOwner key={`${gateway?.scope ?? 'offline'}:${identity}`} expiresAt={expiresAt}>
      {children}
    </DraftOwner>
  );
}

function DraftOwner({ children, expiresAt }: PropsWithChildren<{ expiresAt: number | undefined }>) {
  const [record, setRecord] = useState<DraftRecord | null>(null);
  const [message, setMessage] = useState('');
  const current = useRef(record);
  const sessionDeadline = expiresAt ?? Infinity;
  const boundary = useRef(sessionDeadline);
  useEffect(
    () => () => {
      current.current = null;
    },
    [],
  );
  useEffect(() => {
    boundary.current = sessionDeadline;
  }, [sessionDeadline]);

  const replace = useCallback((next: DraftRecord | null) => {
    current.current = next;
    setRecord(next);
  }, []);
  const clear = useCallback(() => {
    replace(null);
    setMessage('');
  }, [replace]);
  const expire = useCallback(() => {
    if (!current.current) return;
    replace(null);
    setMessage(
      'Час зберігання вибору минув. Виберіть файл знову. Наявна конвертація продовжується.',
    );
  }, [replace]);
  const isCurrent = useCallback(
    (selection: FileSelection) => {
      const draft = current.current;
      if (draft && Date.now() >= Math.min(draft.deadline, boundary.current)) {
        expire();
        return false;
      }
      return draft?.selection === selection;
    },
    [expire],
  );
  const touch = useCallback(() => {
    const draft = current.current;
    if (draft && isCurrent(draft.selection))
      replace({ ...draft, deadline: Date.now() + DRAFT_IDLE_MS });
  }, [isCurrent, replace]);
  const setSelection = useCallback(
    (selection: FileSelection | null) => {
      replace(selection ? { selection, deadline: Date.now() + DRAFT_IDLE_MS, jobId: null } : null);
      setMessage('');
    },
    [replace],
  );
  const bindJob = useCallback(
    (selection: FileSelection, id: string) => {
      if (current.current?.selection === selection) replace({ ...current.current, jobId: id });
    },
    [replace],
  );
  const completeJob = useCallback(
    (id: string) => {
      if (current.current?.jobId === id) clear();
    },
    [clear],
  );

  useEffect(() => {
    if (!record) return;
    const check = () => {
      if (Date.now() >= Math.min(record.deadline, sessionDeadline)) expire();
    };
    const timer = window.setTimeout(
      check,
      Math.max(0, Math.min(record.deadline, sessionDeadline) - Date.now()),
    );
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [record, sessionDeadline, expire]);

  return (
    <ConverterDraftContext
      value={{
        selection: record?.selection ?? null,
        message,
        setSelection,
        touch,
        isCurrent,
        clear,
        bindJob,
        completeJob,
      }}
    >
      {children}
    </ConverterDraftContext>
  );
}
