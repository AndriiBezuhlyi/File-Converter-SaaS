import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from '../src/app/App';
import { FixtureAuthGateway } from './auth-gateway';
import '../src/app/styles/global.scss';

const scenario = new URLSearchParams(window.location.search).get('scenario') ?? 'success';
const gateway = new FixtureAuthGateway(scenario);
const root = document.getElementById('root');
if (!root) throw new Error('Missing test root.');
createRoot(root).render(
  <QueryClientProvider client={new QueryClient()}>
    <p role="note" style={{ margin: 0, padding: 16, color: 'var(--color-warning)', fontSize: 14 }}>
      Тестовий стенд авторизації: без справжнього входу та надсилання листів. Використовуйте
      вигадані дані. Сценарій: {scenario}.
    </p>
    <HashRouter>
      <App authGateway={gateway} />
    </HashRouter>
    <output aria-label="Лічильники стенда авторизації" style={{ display: 'block', padding: 16 }}>
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
