import { createContext, useContext } from 'react';
import type { AuthGateway, AuthSession } from './auth-gateway';

interface AuthContextValue {
  gateway: AuthGateway | undefined;
  session: AuthSession | null;
  status: 'unavailable' | 'pending' | 'error' | 'ready';
  refreshSession: () => Promise<AuthSession>;
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
