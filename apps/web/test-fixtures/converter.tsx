import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppLayout } from '../src/app/layout/AppLayout';
import { authRoutes } from '../src/app/routes';
import { AuthProvider } from '../src/features/auth/components/AuthProvider';
import { AuthPage } from '../src/pages/auth/AuthPage';
import { ConverterPage } from '../src/pages/converter/ConverterPage';
import { FixtureAuthGateway } from './auth-gateway';
import { FixtureGateway, getScenario } from './gateway';
import '../src/app/styles/global.scss';
import { ConverterDraftProvider } from '../src/features/converter/components/ConverterDraftProvider';

const search = new URLSearchParams(window.location.search);
let authenticated = false;
const gateway = new FixtureGateway(
  getScenario(search.get('scenario')),
  search.get('conversion'),
  () => authenticated,
);
const authGateway = new FixtureAuthGateway('success', () => {
  authenticated = true;
});
const root = document.getElementById('root');
if (!root) throw new Error('Missing test root.');

createRoot(root).render(
  <QueryClientProvider client={new QueryClient()}>
    <BrowserRouter basename="/test-fixtures/converter/">
      <AuthProvider gateway={authGateway}>
        <ConverterDraftProvider>
          <Routes>
            <Route element={<AppLayout />}>
              <Route
                index
                element={
                  <>
                    <p
                      role="note"
                      style={{ margin: '0 0 24px', color: 'var(--color-warning)', fontSize: 14 }}
                    >
                      Тестовий стенд: керовані відповіді, без реальної конвертації. Сценарій:{' '}
                      {gateway.scenario}.
                    </p>
                    <ConverterPage gateway={gateway} />
                    <output
                      aria-label="Лічильники тестового стенда"
                      style={{ display: 'block', marginBlock: 24 }}
                    >
                      <button
                        type="button"
                        onClick={(event) => {
                          event.currentTarget.textContent = `POST: ${gateway.submissions}; status: ${gateway.statusReads}; download: ${gateway.downloads}`;
                        }}
                      >
                        Оновити лічильники стенда
                      </button>
                    </output>
                  </>
                }
              />
              {authRoutes.map((route) => (
                <Route
                  key={route.kind}
                  path={route.path}
                  element={<AuthPage key={route.kind} kind={route.kind} />}
                />
              ))}
            </Route>
          </Routes>
        </ConverterDraftProvider>
      </AuthProvider>
    </BrowserRouter>
  </QueryClientProvider>,
);
