import { useMemo } from 'react';
import { App } from './App';
import { AuthProvider } from '../features/auth/components/AuthProvider';
import { useAuth } from '../features/auth/lib/auth-context';
import { createAuthGateway } from '../features/auth/lib/auth-http-gateway';
import { createAccountGateway } from '../features/account/lib/account-http-gateway';
import { createApiKeyGateway } from '../features/api-keys/lib/api-key-http-gateway';
import { createHttpClient } from '../shared/api/http-client';
import { createSessionClient } from '../shared/api/session-client';
import { createConversionGateway } from '../features/converter/lib/conversion-http-gateway';

const client = createSessionClient(createHttpClient());
const auth = createAuthGateway(client);

export function LiveApp() {
  return (
    <AuthProvider gateway={auth}>
      <ConnectedApp />
    </AuthProvider>
  );
}
function ConnectedApp() {
  const { session } = useAuth();
  const identity = session?.kind === 'authenticated' ? session.email : 'anonymous';
  const account = useMemo(() => createAccountGateway(client, identity), [identity]);
  const keys = useMemo(() => createApiKeyGateway(client, identity), [identity]);
  const conversions = useMemo(() => createConversionGateway(client, identity), [identity]);
  return <App accountGateway={account} apiKeyGateway={keys} conversionGateway={conversions} />;
}
