import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../../shared/ui/Button';
import styles from './ApiKey.module.scss';

export function SecretReveal({ secret, onHide }: { secret: string; onHide: () => void }) {
  const id = useId();
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
        <Button variant="secondary" onClick={onHide}>
          Приховати назавжди
        </Button>
      </div>
      <p className={styles.helper}>Після приховування повний ключ більше не відображається.</p>
      {state === 'error' ? (
        <p role="alert" className={styles.error}>
          Не вдалося скопіювати. Виділіть ключ і скопіюйте вручну.
        </p>
      ) : null}
    </div>
  );
}
