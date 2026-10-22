import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { ActionLink } from '../../../shared/ui/ActionLink';
import { Button } from '../../../shared/ui/Button';
import styles from './ConversionWorkspace.module.scss';

export function GuestAuthDialog({
  onClose,
  jobId,
  hasResult,
}: {
  onClose: () => void;
  jobId: string | null;
  hasResult: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const returnTo = jobId ? `/?conversion=${encodeURIComponent(jobId)}` : '/';

  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    element?.querySelector('a')?.focus();
    return () => {
      element?.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = event.currentTarget.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled])',
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <Button
        variant="secondary"
        className={styles.close}
        aria-label="Закрити діалог"
        onClick={onClose}
      >
        <X size={20} strokeWidth={1.75} aria-hidden="true" />
      </Button>
      <h2 id={`${id}-title`}>Продовжіть після входу</h2>
      <p id={`${id}-description`}>
        Безкоштовну конвертацію вже використано. Увійдіть або створіть акаунт, щоб продовжити.
      </p>
      <div className={styles.actions}>
        <ActionLink to={`/login?returnTo=${encodeURIComponent(returnTo)}`}>Увійти</ActionLink>
        <ActionLink variant="secondary" to={`/register?returnTo=${encodeURIComponent(returnTo)}`}>
          Створити акаунт
        </ActionLink>
        <Button variant="secondary" onClick={onClose}>
          {hasResult ? 'Повернутися до результату' : 'Повернутися до конвертера'}
        </Button>
      </div>
      <p className={styles.helper}>
        Після переходу на іншу сторінку виберіть файл повторно. Вхід не зберігає гостьовий результат
        в акаунті.
      </p>
    </dialog>
  );
}
