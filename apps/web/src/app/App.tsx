import { Route, Routes } from 'react-router';
import { lazy, Suspense } from 'react';
import { AppLayout } from './layout/AppLayout';
import { authRoutes } from './routes';
import { AuthProvider } from '../features/auth/components/AuthProvider';
import type { AuthGateway } from '../features/auth/lib/auth-gateway';
import { AuthPage } from '../pages/auth/AuthPage';
import { ConverterPage } from '../pages/converter/ConverterPage';
import { ApiDocsPage } from '../pages/api-docs/ApiDocsPage';
import type { AccountGateway } from '../features/account/lib/account-gateway';
import type { ApiKeyGateway } from '../features/api-keys/lib/api-key-gateway';
import type { FilesGateway } from '../features/files/lib/files-gateway';
import { RoutePreview } from '../pages/route-preview/RoutePreview';
const AccountPage = lazy(() =>
  import('../pages/account/AccountPage').then((module) => ({ default: module.AccountPage })),
);
const FilesPage = lazy(() =>
  import('../pages/files/FilesPage').then((module) => ({ default: module.FilesPage })),
);

export function App({
  authGateway,
  accountGateway,
  apiKeyGateway,
  filesGateway,
}: {
  authGateway?: AuthGateway;
  accountGateway?: AccountGateway;
  apiKeyGateway?: ApiKeyGateway;
  filesGateway?: FilesGateway;
}) {
  return (
    <AuthProvider gateway={authGateway}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<ConverterPage />} />
          <Route path="/api-docs" element={<ApiDocsPage />} />
          <Route
            path="/account"
            element={
              <Suspense fallback={<p role="status">Відкриваємо профіль…</p>}>
                <AccountPage gateway={accountGateway} keyGateway={apiKeyGateway} />
              </Suspense>
            }
          />
          <Route
            path="/files"
            element={
              <Suspense fallback={<p role="status">Відкриваємо файли…</p>}>
                <FilesPage gateway={filesGateway} settingsGateway={accountGateway} />
              </Suspense>
            }
          />
          {authRoutes.map((route) => (
            <Route
              key={route.kind}
              path={route.path}
              element={<AuthPage key={route.kind} kind={route.kind} />}
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
