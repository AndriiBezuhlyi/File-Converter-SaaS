import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Check } from 'lucide-react';
import { Field } from '../../../shared/ui/Field';
import { Button } from '../../../shared/ui/Button';
import { useAuth } from '../lib/auth-context';
import { AuthRequestError } from '../lib/auth-gateway';
import { emailFormSchema } from '../lib/auth-validation';
import { useAuthAction } from '../lib/use-auth-action';
import styles from './Auth.module.scss';

export function EmailRequestForm({ purpose }: { purpose: 'verification' | 'recovery' }) {
  const { gateway } = useAuth();
  const action = useAuthAction();
  const [done, setDone] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(emailFormSchema),
    defaultValues: { email: '' },
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  const label = purpose === 'verification' ? 'Надіслати лист повторно' : 'Надіслати посилання';
  return (
    <form
      noValidate
      className={styles.form}
      aria-label={label}
      aria-busy={action.pending}
      onSubmit={(event) => {
        void handleSubmit(async ({ email }) => {
          setDone(false);
          await action.run(
            async () => {
              if (!gateway) throw new AuthRequestError('unavailable');
              if (purpose === 'verification') await gateway.resendVerification(email);
              else await gateway.requestPasswordReset(email);
            },
            () => setDone(true),
          );
        })(event);
      }}
    >
      <fieldset className={styles.fieldset} disabled={action.pending}>
        <Field
          label="Електронна пошта"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          {...register('email')}
          error={errors.email?.message}
        />
        <Button className={styles.submit} type="submit">
          {action.pending ? 'Зачекайте…' : label}
        </Button>
      </fieldset>
      {done ? (
        <p role="status" className={styles.success}>
          <Check size={24} className={styles.icon} aria-hidden="true" />{' '}
          {purpose === 'verification'
            ? 'Якщо адреса потребує підтвердження, надішлемо лист.'
            : 'Якщо акаунт існує, лист із посиланням надійде на пошту.'}
        </p>
      ) : null}
      {action.error ? (
        <p role="alert" className={styles.error}>
          {action.error}
        </p>
      ) : null}
    </form>
  );
}
