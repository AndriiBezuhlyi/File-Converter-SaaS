import { useId } from 'react';
import { Button } from '../../../shared/ui/Button';
import { dataErrorMessage } from '../../../shared/lib/data-access-error';
import type { SettingsGateway } from '../lib/account-gateway';
import { useAutoSave } from '../lib/account-queries';
import styles from './Account.module.scss';

export function AutoSaveSetting({ gateway }: { gateway: SettingsGateway }) {
  const id = useId();
  const { settings, pending, change, error } = useAutoSave(gateway);
  return (
    <div className={styles.setting}>
      <label className={styles.switchLabel}>
        <input
          type="checkbox"
          role="switch"
          className={styles.switch}
          aria-describedby={id}
          checked={settings.data?.autoSave ?? false}
          disabled={settings.isPending || settings.isError || pending}
          onChange={(event) => change(event.target.checked)}
        />
        Зберігати нові результати
      </label>
      <p id={id} className={styles.helper}>
        Зміни діють для нових конвертацій. Уже збережені файли залишаться.
      </p>
      {settings.isPending || pending ? (
        <p role="status">{pending ? 'Зберігаємо налаштування…' : 'Завантажуємо налаштування…'}</p>
      ) : null}
      {settings.isError ? (
        <div>
          <p role="alert">{dataErrorMessage(settings.error)}</p>
          <Button
            variant="secondary"
            onClick={() => {
              void settings.refetch();
            }}
          >
            Повторити завантаження налаштувань
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert">
          {dataErrorMessage(error)} Зміна не підтверджена. Перевірте поточне значення.
        </p>
      ) : null}
    </div>
  );
}
