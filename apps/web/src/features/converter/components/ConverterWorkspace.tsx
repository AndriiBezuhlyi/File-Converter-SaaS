import { AlertCircle, Clock3 } from 'lucide-react';
import { Surface } from '../../../shared/ui/Surface';
import { Button } from '../../../shared/ui/Button';
import { FileSelector } from './FileSelector';
import { GuestAuthDialog } from './GuestAuthDialog';
import { ConversionResultPanel } from './ConversionResultPanel';
import {
  ConversionRequestError,
  uploadPercent,
  type ConversionGateway,
} from '../lib/conversion-gateway';
import { useConversionFlow } from '../lib/use-conversion-flow';
import styles from './ConversionWorkspace.module.scss';

interface WorkspaceProps {
  gateway?: ConversionGateway | undefined;
  requestedId: string | null;
  onJobId: (id: string | null) => void;
}

export function ConverterWorkspace(props: WorkspaceProps) {
  // Offline production bootstrap never creates a mock job, credential, or download.
  return props.gateway ? (
    <ConnectedWorkspace {...props} gateway={props.gateway} />
  ) : (
    <FileSelector />
  );
}

function ConnectedWorkspace({
  gateway,
  requestedId,
  onJobId,
}: WorkspaceProps & { gateway: ConversionGateway }) {
  const flow = useConversionFlow(gateway, requestedId, onJobId);
  const current = flow.job.data;
  const waiting = flow.upload.isPending || flow.outcome?.kind === 'unknown';
  const showState = waiting || flow.jobId !== null;
  const percent = uploadPercent(flow.progress);
  const disconnected =
    flow.job.isError &&
    (!(flow.job.error instanceof ConversionRequestError) || flow.job.error.kind === 'network');
  const inaccessible = flow.job.isError && !disconnected;
  const unknown = !flow.jobId && flow.outcome?.kind === 'unknown';
  const heading = inaccessible
    ? 'Задача недоступна'
    : disconnected || unknown
      ? 'Відновлюємо зв’язок'
      : flow.upload.isPending
        ? flow.stage === 'checking'
          ? 'Перевіряємо доступ'
          : 'Завантажуємо файл'
        : current?.status === 'completed'
          ? 'Файл готовий'
          : current?.status === 'failed'
            ? 'Не вдалося конвертувати'
            : current?.status === 'processing'
              ? 'Конвертуємо файл'
              : current?.status === 'queued'
                ? 'Файл у черзі'
                : 'Перевіряємо стан';
  const rejected =
    flow.outcome?.kind === 'rejected'
      ? {
          'invalid-file': 'Сервер відхилив файл. Виберіть інший файл або формат.',
          'rate-limit': 'Забагато запитів. Зачекайте перед наступною спробою.',
          unavailable: 'Сервіс тимчасово недоступний. Файл не прийнято; спробуйте пізніше.',
        }[flow.outcome.reason]
      : flow.upload.isError
        ? 'Не вдалося перевірити доступ. Файл не надіслано; спробуйте ще раз.'
        : undefined;
  const canStart = flow.access.isSuccess && !flow.access.isFetching;
  const nextDisabled = !canStart;

  return (
    <>
      <div hidden={showState}>
        <FileSelector
          key={flow.selectionVersion}
          onConvert={canStart ? flow.submit : undefined}
          locked={waiting}
          submissionError={rejected}
          availability={
            flow.access.isError
              ? 'Не вдалося перевірити доступ. Оновіть перевірку перед конвертацією.'
              : !flow.access.data
                ? 'Перевіряємо доступ…'
                : flow.access.data.kind === 'guest'
                  ? flow.access.data.trial === 'consumed'
                    ? 'Безкоштовну конвертацію вже використано. Наступна конвертація потребує входу.'
                    : '1 файл безкоштовно без реєстрації'
                  : 'Файл буде оброблено відповідно до налаштувань на момент прийняття.'
          }
        />
        {flow.access.isError ? (
          <Button
            variant="secondary"
            onClick={() => {
              void flow.access.refetch();
            }}
          >
            Перевірити доступ ще раз
          </Button>
        ) : null}
      </div>
      {showState ? (
        <Surface aria-label="Стан конвертації">
          <p className={styles.annotation}>{'{ Конвертер }'}</p>
          <h2 className={styles.heading}>{heading}</h2>
          <span className="sr-only" role="status">
            {heading}
          </span>
          {disconnected || unknown ? (
            <>
              <p className={styles.notice}>
                <AlertCircle size={24} strokeWidth={1.75} aria-hidden="true" />{' '}
                {unknown
                  ? 'Не отримали підтвердження прийняття. Перевірте стан, перш ніж надсилати файл знову.'
                  : 'Не вдалося перевірити стан. Задача може продовжувати виконуватися.'}
              </p>
              <div className={styles.actions}>
                <Button
                  onClick={() => {
                    if (flow.jobId) void flow.job.refetch();
                    else void flow.access.refetch();
                  }}
                  disabled={flow.job.isFetching || flow.access.isFetching}
                >
                  Перевірити ще раз
                </Button>
              </div>
              <p className={styles.helper}>Повторно файл не надсилаємо.</p>
            </>
          ) : inaccessible ? (
            <>
              <p role="alert" className={styles.warning}>
                Немає доступу до задачі або строк доступності завершився. Повторно файл не
                надсилаємо.
              </p>
              <div className={styles.actions}>
                <Button
                  onClick={() => {
                    void flow.job.refetch();
                  }}
                  disabled={flow.job.isFetching}
                >
                  Перевірити стан ще раз
                </Button>
                <Button variant="secondary" onClick={flow.nextFile} disabled={nextDisabled}>
                  Конвертувати інший файл
                </Button>
              </div>
            </>
          ) : current?.status === 'completed' ? (
            <ConversionResultPanel
              key={current.id}
              job={current}
              gateway={gateway}
              nextFile={flow.nextFile}
              nextDisabled={nextDisabled}
            />
          ) : current?.status === 'failed' ? (
            <>
              <p role="alert" className={styles.danger}>
                {current.reason === 'invalid-file'
                  ? 'Файл пошкоджений або не підтримує цю конвертацію. Виберіть інший файл.'
                  : 'Конвертація завершилася помилкою. Спробуйте інший файл або повторіть пізніше.'}
              </p>
              <p className={styles.helper}>
                {flow.access.data?.kind === 'account'
                  ? 'Виберіть інший файл або спробуйте пізніше.'
                  : 'Остаточна помилка не витрачає гостьову спробу. Перевіряємо її доступність на сервері.'}
              </p>
              <div className={styles.actions}>
                <Button onClick={flow.nextFile} disabled={nextDisabled}>
                  Вибрати інший файл
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className={styles.summary}>
                <Clock3 size={24} strokeWidth={1.75} aria-hidden="true" />
                <div className={styles.details}>
                  <strong className={styles.name}>
                    {current?.sourceName ??
                      flow.upload.variables?.file.name ??
                      'Відновлюємо відому задачу'}
                  </strong>
                  {current ? (
                    <p className={styles.metadata}>
                      <span className={styles.format}>
                        {current.sourceFormat.toUpperCase()} → {current.targetFormat.toUpperCase()}
                      </span>
                    </p>
                  ) : null}
                </div>
              </div>
              <div
                className={styles.bar}
                role="progressbar"
                aria-label={
                  flow.stage === 'uploading' && flow.upload.isPending
                    ? 'Завантаження файла'
                    : 'Обробка файла'
                }
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={flow.upload.isPending ? percent : undefined}
              >
                <span
                  style={{
                    inlineSize: `${flow.upload.isPending && percent !== undefined ? percent : 25}%`,
                  }}
                />
              </div>
              <p className={styles.progressLabel}>
                {flow.upload.isPending && flow.stage === 'uploading'
                  ? percent !== undefined
                    ? `Передано ${percent}%`
                    : 'Передаємо файл…'
                  : current?.status === 'queued'
                    ? 'Очікуємо на обробку.'
                    : 'Можна залишити сторінку відкритою.'}
              </p>
              {flow.upload.isPending && flow.stage === 'uploading' ? (
                <p className={styles.helper}>
                  {percent === 100
                    ? 'Файл передано. Очікуємо підтвердження прийняття.'
                    : 'Після завантаження файл ще потрібно обробити.'}
                </p>
              ) : null}
            </>
          )}
          {flow.access.isError ? (
            <>
              <p className={styles.helper} role="alert">
                Не вдалося оновити доступ. Наявна задача зберігається; нову конвертацію тимчасово
                заблоковано.
              </p>
              <div className={styles.actions}>
                <Button
                  variant="secondary"
                  disabled={flow.access.isFetching}
                  onClick={() => {
                    void flow.access.refetch();
                  }}
                >
                  Перевірити доступ ще раз
                </Button>
              </div>
            </>
          ) : null}
        </Surface>
      ) : null}
      {flow.dialogOpen ? (
        <GuestAuthDialog
          jobId={flow.jobId}
          hasResult={current?.status === 'completed'}
          onClose={flow.closeDialog}
        />
      ) : null}
    </>
  );
}
