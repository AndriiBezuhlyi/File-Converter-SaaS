import { createContext, useContext } from 'react';
import type { AuthGateway, AuthSession, PendingRegistration } from './auth-gateway';

interface AuthContextValue {
  gateway: AuthGateway | undefined;
  session: AuthSession | null;
  sessionExpiresAt?: number | undefined;
  status: 'unavailable' | 'pending' | 'error' | 'ready';
  refreshSession: () => Promise<AuthSession>;
  pendingRegistration?: PendingRegistration | undefined;
  rememberRegistration?: (registration: PendingRegistration | undefined) => void;
}
export const AuthContext = createContext<AuthContextValue>({
  gateway: undefined,
  session: null,
  status: 'unavailable',
  refreshSession: () => Promise.resolve({ kind: 'anonymous' }),
});
export function useAuth() {
  return useContext(AuthContext);
}
