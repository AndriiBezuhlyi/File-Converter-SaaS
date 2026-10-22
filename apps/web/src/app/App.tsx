import { Route, Routes } from 'react-router';
import { AppLayout } from './layout/AppLayout';
import { authRoutes, routePreviews } from './routes';
import { AuthProvider } from '../features/auth/components/AuthProvider';
import type { AuthGateway } from '../features/auth/lib/auth-gateway';
import { AuthPage } from '../pages/auth/AuthPage';
import { ConverterPage } from '../pages/converter/ConverterPage';
import { ApiDocsPage } from '../pages/api-docs/ApiDocsPage';
import { AccountPage } from '../pages/account/AccountPage';
import type { AccountGateway } from '../features/account/lib/account-gateway';
import type { ApiKeyGateway } from '../features/api-keys/lib/api-key-gateway';
import { RoutePreview } from '../pages/route-preview/RoutePreview';

export function App({
  authGateway,
  accountGateway,
  apiKeyGateway,
}: {
  authGateway?: AuthGateway;
  accountGateway?: AccountGateway;
  apiKeyGateway?: ApiKeyGateway;
}) {
  return (
    <AuthProvider gateway={authGateway}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<ConverterPage />} />
          <Route path="/api-docs" element={<ApiDocsPage />} />
          <Route
            path="/account"
            element={<AccountPage gateway={accountGateway} keyGateway={apiKeyGateway} />}
          />
          {authRoutes.map((route) => (
            <Route
              key={route.kind}
              path={route.path}
              element={<AuthPage key={route.kind} kind={route.kind} />}
            />
          ))}
          {routePreviews.map((route) => (
            <Route
              key={route.path}
              path={route.path}
              element={<RoutePreview title={route.title} description={route.description} />}
            />
          ))}
          <Route
            path="*"
            element={
              <RoutePreview
                title="Сторінку не знайдено"
                description="Перевірте адресу або поверніться до конвертера."
              />
            }
          />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
