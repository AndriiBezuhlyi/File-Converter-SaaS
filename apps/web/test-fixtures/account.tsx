import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from '../src/app/App';
import { FixtureAccountGateway } from './account-gateway';
import '../src/app/styles/global.scss';
const gateway = new FixtureAccountGateway(
  new URLSearchParams(window.location.search).get('scenario') ?? 'success',
);
const root = document.getElementById('root');
if (!root) throw new Error('Missing test root.');
createRoot(root).render(
  <QueryClientProvider client={new QueryClient()}>
    <p role="note" style={{ margin: 0, padding: 16, color: 'var(--color-warning)', fontSize: 14 }}>
      Тестовий стенд акаунту: вигадані дані та ключі, без реальних змін. Сценарій:{' '}
      {gateway.accountScenario}.
    </p>
    <HashRouter>
      <App
        authGateway={gateway}
        accountGateway={gateway}
        apiKeyGateway={gateway}
        filesGateway={gateway}
      />
    </HashRouter>
    <output aria-label="Лічильники стенда акаунту" style={{ display: 'block', padding: 16 }}>
      <button
        type="button"
        onClick={(event) => {
          event.currentTarget.textContent = JSON.stringify(gateway.calls);
        }}
      >
        Оновити лічильники
      </button>
    </output>
  </QueryClientProvider>,
);
