import { useEffect, useRef, useState } from 'react';

// Request closures avoid placing credentials, secrets or Blobs into mutation caches.
export function useRequestAction(describeError: (cause: unknown) => string) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function run<T>(
    request: () => Promise<T>,
    onSuccess: (result: T) => void,
    onFailure?: (cause: unknown) => void,
  ) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await request();
      if (mounted.current) onSuccess(result);
    } catch (cause) {
      if (mounted.current) {
        setError(describeError(cause));
        onFailure?.(cause);
      }
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }
  return { pending, error, run };
}
