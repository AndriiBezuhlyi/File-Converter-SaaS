import { useEffect, useRef, useState } from 'react';
import { authErrorMessage } from './auth-gateway';

// Secrets stay in request closures, never mutation variables/caches or browser storage.
export function useAuthAction() {
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

  async function run<T>(request: () => Promise<T>, onSuccess: (value: T) => void) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await request();
      if (mounted.current) onSuccess(result);
    } catch (cause) {
      if (mounted.current) setError(authErrorMessage(cause));
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }
  return { pending, error, run };
}
