import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '../../../shared/ui/Button';
import { Dialog } from '../../../shared/ui/Dialog';
import { PasswordField } from '../../auth/components/PasswordField';
import { DataAccessError, dataErrorMessage } from '../../../shared/lib/data-access-error';
import { useRequestAction } from '../../../shared/lib/use-request-action';
import type { ApiKeyGateway } from '../lib/api-key-gateway';
import { SecretReveal } from './SecretReveal';
import styles from './ApiKey.module.scss';

const confirmationSchema = z.object({
  currentPassword: z.string().min(1, 'Введіть поточний пароль.'),
});
export function ApiKeyPanel({ gateway }: { gateway: ApiKeyGateway }) {
  const client = useQueryClient();
  const queryKey = ['api-keys', gateway.scope];
  const metadata = useQuery({
    queryKey,
    queryFn: ({ signal }) => gateway.readKey(signal),
    retry: false,
  });
  const action = useRequestAction(dataErrorMessage);
  const [open, setOpen] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [secret, setSecret] = useState<{ prefix: string; value: string } | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(confirmationSchema),
    defaultValues: { currentPassword: '' },
  });
  if (secret && !metadata.isPending && metadata.data?.prefix !== secret.prefix) setSecret(null);
  if (metadata.isPending) return <p role="status">Завантажуємо дані ключа…</p>;
  if (metadata.isError)
    return (
      <div>
        <p role="alert">{dataErrorMessage(metadata.error)}</p>
        <Button
          onClick={() => {
            void metadata.refetch();
          }}
        >
          Повторити завантаження ключа
        </Button>
      </div>
    );
  const rotating = metadata.data !== null;
  const close = () => {
    setOpen(false);
    reset();
  };
  return (
    <div className={styles.panel}>
      <div className={styles.summary}>
        {metadata.data ? (
          <>
            <p className={styles.prefix} aria-label="Маскований API-ключ">
              {metadata.data.prefix}••••••••
            </p>
            <p className={styles.helper}>
              Створено: {new Date(metadata.data.createdAt).toLocaleDateString('uk-UA')}
            </p>
          </>
        ) : (
          <p>Активного API-ключа немає.</p>
        )}
        <p className={styles.helper}>
          Повний ключ доступний лише після створення або перевипуску. Зберігайте його на сервері
          вашої інтеграції.
        </p>
      </div>
      {secret ? (
        <SecretReveal key={secret.prefix} secret={secret.value} onHide={() => setSecret(null)} />
      ) : null}
      {uncertain ? (
        <div className={styles.feedback}>
          <p role="alert">
            Відповідь не отримано. Ключ міг бути створений або замінений. Оновіть дані ключа перед
            наступною дією.
          </p>
          <Button
            variant="secondary"
            disabled={metadata.isFetching}
            onClick={() => {
              void metadata.refetch().then((result) => {
                if (result.isSuccess) setUncertain(false);
              });
            }}
          >
            Оновити дані ключа
          </Button>
        </div>
      ) : null}
      <div className={styles.controls}>
        <Button
          disabled={uncertain}
          onClick={() => {
            reset();
            setOpen(true);
          }}
        >
          {rotating ? 'Перевипустити ключ' : 'Створити ключ'}
        </Button>
        {rotating ? (
          <p className={styles.helper}>
            Попередній ключ одразу перестане працювати після перевипуску.
          </p>
        ) : null}
      </div>
      {open ? (
        <Dialog
          title={rotating ? 'Перевипустити API-ключ?' : 'Створити API-ключ?'}
          onClose={close}
          pending={action.pending}
        >
          <form
            noValidate
            className={styles.form}
            aria-label="Підтвердження керування ключем"
            onSubmit={(event) => {
              void handleSubmit(async ({ currentPassword }) => {
                await action.run(
                  async () => {
                    const result = await (rotating
                      ? gateway.rotateKey(currentPassword)
                      : gateway.createKey(currentPassword));
                    await client.cancelQueries({ queryKey });
                    return result;
                  },
                  (result) => {
                    client.setQueryData(queryKey, result.metadata);
                    setSecret({ prefix: result.metadata.prefix, value: result.secret });
                    close();
                  },
                  (cause) => {
                    if (!(cause instanceof DataAccessError) || cause.kind === 'network') {
                      setUncertain(true);
                      setSecret(null);
                      close();
                    }
                  },
                );
              })(event);
            }}
          >
            <p>
              {rotating
                ? 'Попередній ключ одразу перестане працювати.'
                : 'Підтвердьте створення ключа поточним паролем.'}
            </p>
            <fieldset className={styles.fieldset} disabled={action.pending}>
              <PasswordField
                label="Поточний пароль"
                autoComplete="current-password"
                {...register('currentPassword')}
                error={errors.currentPassword?.message}
              />
              <div className={styles.actions}>
                <Button type="submit">
                  {action.pending
                    ? 'Зачекайте…'
                    : rotating
                      ? 'Перевипустити ключ'
                      : 'Створити ключ'}
                </Button>
                <Button variant="secondary" data-initial-focus onClick={close}>
                  Скасувати
                </Button>
              </div>
            </fieldset>
            {action.error ? (
              <p role="alert" className={styles.error}>
                {action.error}
              </p>
            ) : null}
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}
