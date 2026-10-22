import { useId, useState, type ComponentProps } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Field } from '../../../shared/ui/Field';
import styles from './Auth.module.scss';

export function PasswordField(props: Omit<ComponentProps<typeof Field>, 'type'>) {
  const [visible, setVisible] = useState(false);
  const generatedId = useId();
  const id = props.id ?? generatedId;
  return (
    <div className={styles.password}>
      <Field
        {...props}
        id={id}
        type={visible ? 'text' : 'password'}
        className={styles.passwordInput}
      />
      <button
        type="button"
        className={styles.reveal}
        aria-controls={id}
        aria-pressed={visible}
        aria-label={`${visible ? 'Приховати' : 'Показати'}: ${props.label.toLowerCase()}`}
        disabled={props.disabled}
        onClick={() => setVisible(!visible)}
      >
        {visible ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
      </button>
    </div>
  );
}
