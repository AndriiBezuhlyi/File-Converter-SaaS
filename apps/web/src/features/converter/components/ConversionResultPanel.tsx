import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, Download } from 'lucide-react';
import { Button } from '../../../shared/ui/Button';
import {
  ConversionRequestError,
  isResultExpired,
  type ConversionGateway,
  type ConversionJob,
} from '../lib/conversion-gateway';
import { formatFileSize } from '../lib/file-selection';
import { saveDownload } from '../lib/save-download';
import styles from './ConversionWorkspace.module.scss';

const dateFormat = new Intl.DateTimeFormat('uk-UA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export function ConversionResultPanel({
  job,
  gateway,
  nextFile,
  nextDisabled,
}: {
  job: ConversionJob & { status: 'completed' };
  gateway: ConversionGateway;
  nextFile: () => void;
  nextDisabled: boolean;
}) {
  const result = job.result;
  const [now, setNow] = useState(Date.now);
  const downloading = useRef(false);
  const deadline = result.retention.kind === 'temporary' ? result.retention.expiresAt : null;
  useEffect(() => {
    if (!deadline) return;
    const time = Date.parse(deadline);
    if (!Number.isFinite(time) || time <= now) return;
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.min(Math.max(time - Date.now() + 1, 0), 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [deadline, now]);

  const download = useMutation({
    retry: false,
    mutationFn: async () => {
      if (isResultExpired(result, Date.now())) throw new ConversionRequestError('expired');
      const file = await gateway.download(job.id);
      if (isResultExpired(result, Date.now())) throw new ConversionRequestError('expired');
      saveDownload(file.blob, file.name);
    },
    onSettled: () => {
      downloading.current = false;
    },
  });
  const denied =
    download.error instanceof ConversionRequestError && download.error.kind !== 'network';
  const unavailable = isResultExpired(result, now) || denied;
  const expiryLabel =
    deadline && Number.isFinite(Date.parse(deadline))
      ? dateFormat.format(new Date(deadline))
      : null;

  return (
    <>
      <div className={styles.summary}>
        <Check className={styles.success} size={24} strokeWidth={1.75} aria-hidden="true" />
        <div className={styles.details}>
          <strong className={styles.name}>
            {result.name ?? `Результат ${result.format.toUpperCase()}`}
          </strong>
          <div className={styles.metadata}>
            <span className={styles.format}>{result.format.toUpperCase()}</span>
            {result.sizeBytes !== null ? <span>{formatFileSize(result.sizeBytes)}</span> : null}
          </div>
        </div>
      </div>
      {unavailable ? (
        <p className={styles.warning} role="status">
          Результат більше недоступний.{' '}
          {result.owner === 'guest'
            ? 'Завершення строку не відновлює безкоштовну спробу.'
            : 'Для нової конвертації виберіть інший файл.'}
        </p>
      ) : null}
      {download.isError && !denied ? (
        <p role="alert" className={styles.danger}>
          Не вдалося завантажити результат. Конвертація завершена; спробуйте завантажити файл ще
          раз.
        </p>
      ) : null}
      {download.isSuccess ? (
        <p role="status" className={styles.helper}>
          Файл передано браузеру.
        </p>
      ) : null}
      <div className={styles.actions}>
        {!unavailable ? (
          <Button
            disabled={download.isPending}
            onClick={() => {
              if (downloading.current) return;
              downloading.current = true;
              download.mutate();
            }}
            aria-busy={download.isPending}
          >
            <Download size={20} strokeWidth={1.75} aria-hidden="true" />{' '}
            {download.isPending ? 'Завантажуємо результат…' : 'Завантажити'}
          </Button>
        ) : null}
        <Button
          variant="secondary"
          onClick={nextFile}
          disabled={nextDisabled || download.isPending}
        >
          Конвертувати інший файл
        </Button>
      </div>
      <p className={styles.helper}>
        {result.retention.kind === 'saved'
          ? unavailable
            ? 'Збережений результат недоступний.'
            : 'Збережено в «Мої файли»'
          : expiryLabel
            ? `${unavailable ? 'Строк зберігання:' : 'Доступний до'} ${expiryLabel}`
            : 'Строк доступності не підтверджено.'}
      </p>
      {result.owner === 'guest' ? (
        <p className={styles.helper}>Гостьовий результат не зберігається в акаунті.</p>
      ) : null}
    </>
  );
}
