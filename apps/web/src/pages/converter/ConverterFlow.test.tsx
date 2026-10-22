import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConverterPage } from './ConverterPage';
import {
  ConversionRequestError,
  type ConversionAccess,
  type ConversionGateway,
  type ConversionJob,
  type ConversionResult,
  type SubmissionOutcome,
  type UploadProgress,
} from '../../features/converter/lib/conversion-gateway';
import { ConversionResultPanel } from '../../features/converter/components/ConversionResultPanel';

const clients: QueryClient[] = [];
const queued: ConversionJob = {
  id: 'job_1',
  status: 'queued',
  sourceName: 'source.jpg',
  sourceFormat: 'jpg',
  targetFormat: 'png',
};
const result: ConversionResult = {
  name: 'output.png',
  sizeBytes: 500,
  format: 'png',
  owner: 'guest',
  availability: 'available',
  retention: { kind: 'temporary', expiresAt: '2099-10-22T19:00:00Z' },
};
const complete: ConversionJob & { status: 'completed' } = {
  ...queued,
  status: 'completed',
  result,
};

function fixture() {
  const state: { access: ConversionAccess; job: ConversionJob } = {
    access: { kind: 'guest', trial: 'available', jobId: null },
    job: queued,
  };
  const gateway = {
    scope: 'unit-fixture',
    readAccess: vi.fn<ConversionGateway['readAccess']>(() => Promise.resolve(state.access)),
    readJob: vi.fn<ConversionGateway['readJob']>(() => Promise.resolve(state.job)),
    submit: vi.fn<ConversionGateway['submit']>(() => {
      state.access = { kind: 'guest', trial: 'reserved', jobId: 'job_1' };
      return Promise.resolve({ kind: 'accepted', job: state.job });
    }),
    download: vi.fn<ConversionGateway['download']>(() =>
      Promise.reject(new ConversionRequestError('network')),
    ),
  };
  return { gateway, state };
}

function client() {
  const instance = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  clients.push(instance);
  return instance;
}

function mount(gateway: ConversionGateway, initial = '/') {
  const instance = client();
  render(
    <QueryClientProvider client={instance}>
      <MemoryRouter initialEntries={[initial]}>
        <ConverterPage gateway={gateway} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return instance;
}

async function selectAndStart() {
  const user = userEvent.setup();
  await user.upload(
    screen.getByLabelText('Файл для конвертації'),
    new File(['synthetic source'], 'source.jpg'),
  );
  await waitFor(() => expect(screen.getByRole('button', { name: 'Конвертувати' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: 'Конвертувати' }));
  return user;
}

beforeEach(() => {
  // jsdom has no native modal lifecycle; real focus trapping/Escape are covered in Chromium.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
afterEach(() => {
  clients.splice(0).forEach((instance) => instance.clear());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('does not equate upload 100% with acceptance and prevents duplicate submissions', async () => {
  const { gateway, state } = fixture();
  let report: (progress: UploadProgress) => void = () => {};
  let accept: (value: SubmissionOutcome) => void = () => {};
  gateway.submit.mockImplementation((selection, onProgress) => {
    expect(selection.file.name).toBe('source.jpg');
    report = onProgress;
    onProgress({ loaded: 48, total: 100 });
    return new Promise((resolve) => {
      accept = resolve;
    });
  });
  mount(gateway);
  const user = await selectAndStart();
  expect(await screen.findByText('Передано 48%')).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '48');
  act(() => {
    report({ loaded: 100, total: 100 });
  });
  expect(screen.getByText('Файл передано. Очікуємо підтвердження прийняття.')).toBeInTheDocument();
  expect(screen.queryByText('Файл готовий')).not.toBeInTheDocument();
  await user.keyboard('{Enter}{Enter}');
  expect(gateway.submit).toHaveBeenCalledTimes(1);
  state.access = { kind: 'guest', trial: 'reserved', jobId: 'job_1' };
  act(() => {
    accept({ kind: 'accepted', job: queued });
  });
  expect(await screen.findByRole('heading', { name: 'Файл у черзі' })).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
});

it('gates a consumed guest before upload and preserves the selected file on dialog close', async () => {
  const { gateway, state } = fixture();
  state.access = { kind: 'guest', trial: 'consumed', jobId: null };
  mount(gateway);
  await selectAndStart();
  const dialog = await screen.findByRole('dialog', { name: 'Продовжіть після входу' });
  expect(within(dialog).getByRole('link', { name: 'Увійти' })).toHaveFocus();
  expect(gateway.submit).not.toHaveBeenCalled();
  fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByText('source.jpg')).toBeInTheDocument();
});

it('keeps an existing successful result downloadable while the next guest conversion is gated', async () => {
  const { gateway, state } = fixture();
  state.job = complete;
  state.access = { kind: 'guest', trial: 'consumed', jobId: 'job_1' };
  mount(gateway, '/?conversion=job_1');
  expect(await screen.findByRole('button', { name: 'Завантажити' })).toBeEnabled();
  const next = screen.getByRole('button', { name: 'Конвертувати інший файл' });
  await waitFor(() => expect(next).toBeEnabled());
  await userEvent.click(next);
  const dialog = screen.getByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Повернутися до результату' }));
  expect(screen.getByRole('button', { name: 'Завантажити' })).toBeEnabled();
  expect(next).toHaveFocus();
  expect(gateway.submit).not.toHaveBeenCalled();
});

it('shows a terminal failure, refreshes server eligibility, and permits a new selection', async () => {
  const { gateway, state } = fixture();
  state.job = { ...queued, status: 'failed', reason: 'invalid-file' };
  state.access = { kind: 'guest', trial: 'available', jobId: 'job_1' };
  mount(gateway, '/?conversion=job_1');
  expect(
    await screen.findByRole('heading', { name: 'Не вдалося конвертувати' }),
  ).toBeInTheDocument();
  const next = screen.getByRole('button', { name: 'Вибрати інший файл' });
  await waitFor(() => expect(next).toBeEnabled());
  await userEvent.click(next);
  expect(await screen.findByText('1 файл безкоштовно без реєстрації')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Вибрати файл' })).toBeEnabled();
  expect(gateway.submit).not.toHaveBeenCalled();
});

it('retains a processing job on connection failure and reconnects without a second upload', async () => {
  const { gateway, state } = fixture();
  state.job = { ...queued, status: 'processing' };
  state.access = { kind: 'guest', trial: 'reserved', jobId: 'job_1' };
  const instance = mount(gateway, '/?conversion=job_1');
  await screen.findByRole('heading', { name: 'Конвертуємо файл' });
  gateway.readJob.mockRejectedValueOnce(new ConversionRequestError('network'));
  await act(async () => {
    await instance.invalidateQueries({ queryKey: ['converter', gateway.scope, 'job'] });
  });
  expect(await screen.findByRole('heading', { name: 'Відновлюємо зв’язок' })).toBeInTheDocument();
  expect(instance.getQueryData(['converter', gateway.scope, 'job', 'job_1'])).toMatchObject({
    status: 'processing',
  });
  state.job = complete;
  state.access = { kind: 'guest', trial: 'consumed', jobId: 'job_1' };
  await userEvent.click(screen.getByRole('button', { name: 'Перевірити ще раз' }));
  expect(await screen.findByRole('heading', { name: 'Файл готовий' })).toBeInTheDocument();
  expect(gateway.submit).not.toHaveBeenCalled();
  expect(gateway.readJob.mock.calls.every(([id]) => id === 'job_1')).toBe(true);
});

it('blocks replay after an ambiguous submission even when an access recheck has no known job', async () => {
  const { gateway } = fixture();
  gateway.submit.mockRejectedValue(new Error('Synthetic network failure'));
  mount(gateway);
  await selectAndStart();
  expect(await screen.findByRole('heading', { name: 'Відновлюємо зв’язок' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Перевірити ще раз' }));
  expect(gateway.submit).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'Конвертувати' })).not.toBeInTheDocument();
  expect(screen.getByText('Повторно файл не надсилаємо.')).toBeInTheDocument();
});

it('does not send bytes on a failed preflight and preserves selection for an explicit retry', async () => {
  const { gateway } = fixture();
  mount(gateway);
  const user = userEvent.setup();
  await user.upload(
    screen.getByLabelText('Файл для конвертації'),
    new File(['synthetic'], 'source.jpg'),
  );
  await waitFor(() => expect(screen.getByRole('button', { name: 'Конвертувати' })).toBeEnabled());
  gateway.readAccess.mockRejectedValueOnce(new ConversionRequestError('network'));
  await user.click(screen.getByRole('button', { name: 'Конвертувати' }));
  expect(
    await screen.findByText('Не вдалося перевірити доступ. Файл не надіслано; спробуйте ще раз.'),
  ).toBeInTheDocument();
  expect(screen.getByText('source.jpg')).toBeInTheDocument();
  expect(gateway.submit).not.toHaveBeenCalled();
});

it('resumes the server-reserved job and does not create another submission', async () => {
  const { gateway, state } = fixture();
  state.access = { kind: 'guest', trial: 'reserved', jobId: 'job_1' };
  mount(gateway);
  await screen.findByRole('heading', { name: 'Файл у черзі' });
  expect(screen.queryByRole('button', { name: 'Конвертувати' })).not.toBeInTheDocument();
  expect(gateway.submit).not.toHaveBeenCalled();
});

it('keeps expired/deleted results complete, hides downloads, and does not renew the guest trial', async () => {
  const { gateway, state } = fixture();
  state.job = { ...complete, result: { ...result, availability: 'expired' } };
  state.access = { kind: 'guest', trial: 'consumed', jobId: 'job_1' };
  const instance = mount(gateway, '/?conversion=job_1');
  await screen.findByRole('heading', { name: 'Файл готовий' });
  expect(screen.queryByRole('button', { name: 'Завантажити' })).not.toBeInTheDocument();
  await waitFor(() =>
    expect(instance.getQueryData(['converter', gateway.scope, 'access'])).toMatchObject({
      trial: 'consumed',
    }),
  );
  expect(gateway.download).not.toHaveBeenCalled();
});

it('separates download network errors from conversion failure', async () => {
  const { gateway, state } = fixture();
  state.job = complete;
  state.access = { kind: 'guest', trial: 'consumed', jobId: 'job_1' };
  mount(gateway, '/?conversion=job_1');
  await userEvent.click(await screen.findByRole('button', { name: 'Завантажити' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Конвертація завершена');
  expect(screen.getByRole('heading', { name: 'Файл готовий' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Завантажити' })).toBeEnabled();
  expect(gateway.submit).not.toHaveBeenCalled();
});

it('removes the download action at the server deadline without a polling loop', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-22T18:00:00Z'));
  const { gateway } = fixture();
  const expiring = {
    ...complete,
    result: {
      ...result,
      retention: { kind: 'temporary' as const, expiresAt: '2026-10-22T18:00:01Z' },
    },
  };
  render(
    <QueryClientProvider client={client()}>
      <ConversionResultPanel
        job={expiring}
        gateway={gateway}
        nextFile={() => {}}
        nextDisabled={false}
      />
    </QueryClientProvider>,
  );
  expect(screen.getByRole('button', { name: 'Завантажити' })).toBeInTheDocument();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_002);
  });
  expect(screen.queryByRole('button', { name: 'Завантажити' })).not.toBeInTheDocument();
  expect(gateway.download).not.toHaveBeenCalled();
});

it('offers a visible access retry after completion without hiding the existing download', async () => {
  const { gateway, state } = fixture();
  state.job = complete;
  state.access = { kind: 'guest', trial: 'consumed', jobId: 'job_1' };
  gateway.readAccess.mockRejectedValue(new ConversionRequestError('network'));
  mount(gateway, '/?conversion=job_1');
  await screen.findByRole('heading', { name: 'Файл готовий' });
  const retry = await screen.findByRole('button', { name: 'Перевірити доступ ще раз' });
  expect(screen.getByRole('button', { name: 'Конвертувати інший файл' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Завантажити' })).toBeEnabled();
  gateway.readAccess.mockResolvedValue(state.access);
  await userEvent.click(retry);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Конвертувати інший файл' })).toBeEnabled(),
  );
  expect(gateway.submit).not.toHaveBeenCalled();
});

it('offers explicit recovery from an inaccessible route without submitting or editing quota', async () => {
  const { gateway } = fixture();
  gateway.readJob.mockRejectedValue(new ConversionRequestError('not-found'));
  const instance = mount(gateway, '/?conversion=unavailable_job');
  await screen.findByRole('heading', { name: 'Задача недоступна' });
  expect(screen.getByRole('button', { name: 'Перевірити стан ще раз' })).toBeEnabled();
  const next = screen.getByRole('button', { name: 'Конвертувати інший файл' });
  await waitFor(() => expect(next).toBeEnabled());
  await userEvent.click(next);
  expect(await screen.findByRole('button', { name: 'Вибрати файл' })).toBeEnabled();
  expect(instance.getQueryData(['converter', gateway.scope, 'access'])).toMatchObject({
    trial: 'available',
    jobId: null,
  });
  expect(gateway.submit).not.toHaveBeenCalled();
});

it('handles a server-side quota race without replay and preserves the source selection', async () => {
  const { gateway, state } = fixture();
  gateway.submit.mockImplementation(() => {
    state.access = { kind: 'guest', trial: 'consumed', jobId: null };
    return Promise.resolve({ kind: 'sign-in-required' });
  });
  mount(gateway);
  await selectAndStart();
  const dialog = await screen.findByRole('dialog');
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(screen.getByText('source.jpg')).toBeInTheDocument();
  expect(gateway.submit).toHaveBeenCalledTimes(1);
});

it('resumes the existing job when the server reports a reservation race', async () => {
  const { gateway, state } = fixture();
  state.job = { ...queued, id: 'another_job', status: 'processing' };
  gateway.submit.mockImplementation(() => {
    state.access = { kind: 'guest', trial: 'reserved', jobId: 'another_job' };
    return Promise.resolve({ kind: 'active', jobId: 'another_job' });
  });
  mount(gateway);
  await selectAndStart();
  await screen.findByRole('heading', { name: 'Конвертуємо файл' });
  expect(gateway.readJob.mock.calls.every(([id]) => id === 'another_job')).toBe(true);
  expect(gateway.submit).toHaveBeenCalledTimes(1);
});

it('keeps rejected files selectable and ignores late progress from an older attempt', async () => {
  const { gateway } = fixture();
  let oldProgress: (progress: UploadProgress) => void = () => {};
  gateway.submit.mockImplementationOnce((selection, report) => {
    expect(selection.targetFormat).toBe('png');
    oldProgress = report;
    return Promise.resolve({ kind: 'rejected', reason: 'invalid-file' });
  });
  mount(gateway);
  const user = await selectAndStart();
  expect(await screen.findByRole('alert')).toHaveTextContent('Сервер відхилив файл');
  expect(screen.getByText('source.jpg')).toBeInTheDocument();
  let finish: (value: SubmissionOutcome) => void = () => {};
  gateway.submit.mockImplementationOnce((selection, report) => {
    expect(selection.file.name).toBe('source.jpg');
    report({ loaded: 25, total: 100 });
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const button = screen.getByRole('button', { name: 'Конвертувати' });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  await screen.findByText('Передано 25%');
  act(() => {
    oldProgress({ loaded: 99, total: 100 });
  });
  expect(screen.getByText('Передано 25%')).toBeInTheDocument();
  act(() => {
    finish({ kind: 'unknown' });
  });
  await screen.findByRole('heading', { name: 'Відновлюємо зв’язок' });
});

it('uses the accepted saved policy and invalidates the files list without guest expiry copy', async () => {
  const { gateway, state } = fixture();
  state.job = {
    ...complete,
    result: { ...result, owner: 'account', retention: { kind: 'saved' } },
  };
  state.access = { kind: 'account', jobId: 'job_1' };
  const instance = mount(gateway, '/?conversion=job_1');
  instance.setQueryDefaults(['files'], { gcTime: Infinity });
  instance.setQueryData(['files'], []);
  expect(await screen.findByText('Збережено в «Мої файли»')).toBeInTheDocument();
  expect(screen.queryByText(/Доступний до/)).not.toBeInTheDocument();
  expect(
    screen.queryByText('Гостьовий результат не зберігається в акаунті.'),
  ).not.toBeInTheDocument();
  await waitFor(() => expect(instance.getQueryState(['files'])?.isInvalidated).toBe(true));
});

it.each(['not-found', 'expired', 'forbidden'] as const)(
  'removes a download denied by the server (%s) while keeping completion',
  async (kind) => {
    const { gateway, state } = fixture();
    state.job = complete;
    gateway.download.mockRejectedValue(new ConversionRequestError(kind));
    mount(gateway, '/?conversion=job_1');
    await userEvent.click(await screen.findByRole('button', { name: 'Завантажити' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Завантажити' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('heading', { name: 'Файл готовий' })).toBeInTheDocument();
    expect(gateway.submit).not.toHaveBeenCalled();
  },
);
