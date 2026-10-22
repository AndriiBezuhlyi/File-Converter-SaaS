import { useId, type ComponentProps } from 'react';
import styles from './Field.module.scss';

interface FieldProps extends ComponentProps<'input'> {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
}

export function Field({
  id,
  label,
  hint,
  error,
  className = '',
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  ...props
}: FieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const descriptionIds =
    [describedBy, hint ? `${fieldId}-hint` : '', error ? `${fieldId}-error` : '']
      .filter(Boolean)
      .join(' ') || undefined;
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={fieldId}>
        {label}
      </label>
      <input
        {...props}
        id={fieldId}
        className={`${styles.control} ${className}`}
        aria-describedby={descriptionIds}
        aria-invalid={error ? true : invalid}
      />
      {hint ? (
        <p id={`${fieldId}-hint`} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${fieldId}-error`} className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
