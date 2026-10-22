import { useEffect, useId, useRef, type PropsWithChildren } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';
import styles from './Dialog.module.scss';

export function Dialog({
  title,
  onClose,
  pending = false,
  children,
}: PropsWithChildren<{ title: string; onClose: () => void; pending?: boolean }>) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    element?.querySelector<HTMLElement>('[data-initial-focus]')?.focus();
    return () => {
      element?.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = event.currentTarget.querySelectorAll<HTMLElement>(
          'a[href],button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)',
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <Button
        variant="secondary"
        className={styles.close}
        aria-label="Закрити діалог"
        disabled={pending}
        onClick={onClose}
      >
        <X size={20} aria-hidden="true" />
      </Button>
      <h2 id={id}>{title}</h2>
      {children}
    </dialog>
  );
}
