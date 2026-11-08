import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../../shared/ui/Button';
import { Dialog } from '../../../shared/ui/Dialog';
import styles from './ApiKey.module.scss';

export function SecretReveal({ secret, onHide }: { secret: string; onHide: () => void }) {
  const id = useId();
  const [confirmHide, setConfirmHide] = useState(false);
  const [state, setState] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle');
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function copy() {
    setState('copying');
    try {
      await navigator.clipboard.writeText(secret);
      if (mounted.current) setState('copied');
    } catch {
      if (mounted.current) setState('error');
    }
  }
  return (
    <div className={styles.reveal}>
      <p role="status">Новий ключ створено. Скопіюйте його зараз.</p>
      <div className={styles.secretLabel}>
        <label htmlFor={id}>Новий API-ключ</label>
        <textarea id={id} readOnly autoComplete="off" spellCheck={false} rows={3} value={secret} />
      </div>
      <div className={styles.actions}>
        <Button
          variant="secondary"
          disabled={state === 'copying'}
          onClick={() => {
            void copy();
          }}
        >
          {state === 'copied'
            ? 'Ключ скопійовано'
            : state === 'copying'
              ? 'Копіювання…'
              : 'Копіювати ключ'}
        </Button>
        <Button variant="secondary" onClick={() => setConfirmHide(true)}>
          Приховати назавжди
        </Button>
      </div>
      <p className={styles.helper}>Після приховування повний ключ більше не відображається.</p>
      {state === 'error' ? (
        <p role="alert" className={styles.error}>
          Не вдалося скопіювати. Виділіть ключ і скопіюйте вручну.
        </p>
      ) : null}
      {confirmHide ? (
        <Dialog title="Приховати API-ключ?" onClose={() => setConfirmHide(false)}>
          <p>
            Повний ключ більше не можна буде відобразити. Скопіюйте його перед приховуванням.
            Приховування не відкликає ключ — він і далі працюватиме.
          </p>
          <div className={styles.actions}>
            <Button onClick={onHide}>Приховати ключ</Button>
            <Button variant="secondary" data-initial-focus onClick={() => setConfirmHide(false)}>
              Скасувати
            </Button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
