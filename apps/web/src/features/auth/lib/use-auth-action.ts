import { useRequestAction } from '../../../shared/lib/use-request-action';
import { authErrorMessage } from './auth-gateway';

// Secrets stay in request closures, never mutation variables/caches or browser storage.
export function useAuthAction() {
  return useRequestAction(authErrorMessage);
}
