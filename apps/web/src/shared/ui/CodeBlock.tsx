import { useId, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from './Button';
import styles from './CodeBlock.module.scss';

interface CodeBlockProps {
  label: string;
  code: string;
}

export function CodeBlock({ label, code }: CodeBlockProps) {
  const id = useId();
  const [state, setState] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle');
  const Icon = state === 'copied' ? Check : Copy;

  async function copyCode() {
    setState('copying');
    try {
      await navigator.clipboard.writeText(code);
      setState('copied');
    } catch {
      setState('error');
    }
  }

  return (
    <figure className={styles.block} aria-labelledby={`${id}-label`}>
      <figcaption className={styles.header}>
        <span id={`${id}-label`} className={styles.label}>
          {label}
        </span>
        <Button
          variant="secondary"
          className={styles.copy}
          onClick={copyCode}
          disabled={state === 'copying'}
          aria-busy={state === 'copying'}
          aria-label={`${state === 'copied' ? 'Скопійовано' : 'Копіювати'}: ${label}`}
          aria-describedby={state === 'error' ? `${id}-error` : undefined}
        >
          <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
          {state === 'copied' ? 'Скопійовано' : state === 'copying' ? 'Копіювання…' : 'Копіювати'}
        </Button>
      </figcaption>
      <pre className={styles.code} tabIndex={0} role="region" aria-label={`Код: ${label}`}>
        <code>{code}</code>
      </pre>
      {state === 'error' ? (
        <p id={`${id}-error`} className={styles.error} role="alert">
          Не вдалося скопіювати. Виділіть і скопіюйте код вручну.
        </p>
      ) : null}
      <span className="sr-only" role="status">
        {state === 'copied' ? `${label}: код скопійовано.` : ''}
      </span>
    </figure>
  );
}
