import { Route, Routes } from 'react-router';
import { Component, lazy, Suspense, type ReactNode } from 'react';
import { AppLayout } from './layout/AppLayout';
import { authRoutes } from './routes';
import { AuthProvider } from '../features/auth/components/AuthProvider';
import type { AuthGateway } from '../features/auth/lib/auth-gateway';
import { ConverterPage } from '../pages/converter/ConverterPage';
import type { AccountGateway } from '../features/account/lib/account-gateway';
import type { ApiKeyGateway } from '../features/api-keys/lib/api-key-gateway';
import type { FilesGateway } from '../features/files/lib/files-gateway';
import type { ConversionGateway } from '../features/converter/lib/conversion-gateway';
import { RoutePreview } from '../pages/route-preview/RoutePreview';
import { ConverterDraftProvider } from '../features/converter/components/ConverterDraftProvider';
const AuthPage = lazy(() =>
  import('../pages/auth/AuthPage').then((module) => ({ default: module.AuthPage })),
);
const ApiDocsPage = lazy(() =>
  import('../pages/api-docs/ApiDocsPage').then((module) => ({ default: module.ApiDocsPage })),
);
const AccountPage = lazy(() =>
  import('../pages/account/AccountPage').then((module) => ({ default: module.AccountPage })),
);
const FilesPage = lazy(() =>
  import('../pages/files/FilesPage').then((module) => ({ default: module.FilesPage })),
);

class RouteLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? (
      <div role="alert">
        <p>Не вдалося відкрити сторінку. Оновіть її, щоб спробувати ще раз.</p>
        <a href="">Оновити сторінку</a>
      </div>
    ) : (
      this.props.children
    );
  }
}

export function App({
  authGateway,
  accountGateway,
  apiKeyGateway,
  filesGateway,
  conversionGateway,
}: {
  authGateway?: AuthGateway;
  accountGateway?: AccountGateway;
  apiKeyGateway?: ApiKeyGateway;
  filesGateway?: FilesGateway;
  conversionGateway?: ConversionGateway;
}) {
  return (
    <AuthProvider gateway={authGateway}>
      <ConverterDraftProvider>
        <Routes>
          <Route element={<AppLayout />}>
            <Route
              index
              element={
                <ConverterPage
                  key={conversionGateway?.scope}
                  {...(conversionGateway ? { gateway: conversionGateway } : {})}
                />
              }
            />
            <Route
              path="/api-docs"
              element={
                <RouteLoadBoundary key="api-docs">
                  <Suspense fallback={<p role="status">Відкриваємо документацію API…</p>}>
                    <ApiDocsPage />
                  </Suspense>
                </RouteLoadBoundary>
              }
            />
            <Route
              path="/account"
              element={
                <Suspense fallback={<p role="status">Відкриваємо профіль…</p>}>
                  <AccountPage
                    key={accountGateway?.scope}
                    gateway={accountGateway}
                    keyGateway={apiKeyGateway}
                  />
                </Suspense>
              }
            />
            <Route
              path="/files"
              element={
                <Suspense fallback={<p role="status">Відкриваємо файли…</p>}>
                  <FilesPage
                    key={accountGateway?.scope}
                    gateway={filesGateway}
                    settingsGateway={accountGateway}
                  />
                </Suspense>
              }
            />
            {authRoutes.map((route) => (
              <Route
                key={route.kind}
                path={route.path}
                element={
                  <RouteLoadBoundary key={route.kind}>
                    <Suspense fallback={<p role="status">Відкриваємо сторінку…</p>}>
                      <AuthPage key={route.kind} kind={route.kind} />
                    </Suspense>
                  </RouteLoadBoundary>
                }
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
      </ConverterDraftProvider>
    </AuthProvider>
  );
}
