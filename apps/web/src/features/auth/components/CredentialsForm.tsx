import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Check } from 'lucide-react';
import { Field } from '../../../shared/ui/Field';
import { Button } from '../../../shared/ui/Button';
import { PasswordField } from './PasswordField';
import { useAuth } from '../lib/auth-context';
import { AuthRequestError } from '../lib/auth-gateway';
import { authHref, credentialsSchema, type CredentialsMode } from '../lib/auth-validation';
import { useAuthAction } from '../lib/use-auth-action';
import styles from './Auth.module.scss';

export function CredentialsForm({
  mode,
  returnTo,
  token,
  onTokenUsed,
}: {
  mode: CredentialsMode;
  returnTo: string;
  token?: string | null;
  onTokenUsed?: () => void;
}) {
  const { gateway, refreshSession, status } = useAuth();
  const navigate = useNavigate();
  const action = useAuthAction();
  const [done, setDone] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(credentialsSchema(mode)),
    defaultValues: { email: '', password: '', confirmation: '' },
    // Validate on submit, then on edits: blur-time error reflow can swallow a pointer click.
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  const label =
    mode === 'login' ? 'Увійти' : mode === 'register' ? 'Створити акаунт' : 'Зберегти пароль';

  if (done)
    return (
      <div className={styles.section}>
        <p role="status" className={styles.success}>
          <Check size={24} className={styles.icon} aria-hidden="true" /> Пароль змінено. Увійдіть із
          новим паролем.
        </p>
      </div>
    );
  if (mode === 'reset' && !token)
    return (
      <div className={styles.section}>
        <p role="status">
          Відкрийте посилання з листа для зміни пароля. Якщо воно недійсне або втратило чинність,
          запросіть нове.
        </p>
        <Link to={authHref('/forgot-password', returnTo)}>Запросити нове посилання</Link>
      </div>
    );

  return (
    <form
      className={styles.form}
      noValidate
      aria-label={label}
      aria-busy={action.pending}
      onSubmit={(event) => {
        void handleSubmit(async (data) => {
          await action.run(
            async () => {
              if (!gateway) throw new AuthRequestError('unavailable');
              if (mode === 'register') {
                await gateway.register({ email: data.email, password: data.password });
                return 'verification-required';
              }
              if (mode === 'reset') {
                await gateway.resetPassword(token!, data.password);
                return 'reset';
              }
              const result = await gateway.signIn({ email: data.email, password: data.password });
              if (result === 'signed-in') {
                const session = await refreshSession();
                if (session.kind !== 'authenticated') throw new AuthRequestError('network');
              }
              return result;
            },
            (result) => {
              reset();
              if (result === 'reset') {
                onTokenUsed?.();
                setDone(true);
                // The password change is committed; session read failure cannot undo it.
                // AuthProvider exposes a separate retry if session synchronization fails.
                void refreshSession().catch(() => {});
              } else if (result === 'verification-required')
                void navigate(authHref('/verify-email', returnTo));
              else void navigate(returnTo);
            },
          );
        })(event);
      }}
    >
      <fieldset className={styles.fieldset} disabled={action.pending || status === 'pending'}>
        {mode !== 'reset' ? (
          <Field
            label="Електронна пошта"
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            {...register('email')}
            error={errors.email?.message}
          />
        ) : null}
        <PasswordField
          label={mode === 'reset' ? 'Новий пароль' : 'Пароль'}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          {...register('password')}
          error={errors.password?.message}
          hint={mode !== 'login' ? 'Від 8 до 128 символів. Пробіли враховуються.' : undefined}
        />
        {mode !== 'login' ? (
          <PasswordField
            label="Повторіть пароль"
            autoComplete="new-password"
            {...register('confirmation')}
            error={errors.confirmation?.message}
          />
        ) : null}
        {mode === 'login' ? (
          <Link to={authHref('/forgot-password', returnTo)}>Забули пароль?</Link>
        ) : null}
        <Button type="submit" className={styles.submit}>
          {action.pending ? 'Зачекайте…' : label}
          <ArrowRight size={20} aria-hidden="true" />
        </Button>
      </fieldset>
      {action.error ? (
        <div className={styles.feedback}>
          <p className={styles.error} role="alert">
            {action.error}
          </p>
          {mode === 'reset' ? (
            <Link to={authHref('/forgot-password', returnTo)}>Запросити нове посилання</Link>
          ) : null}
        </div>
      ) : null}
      {mode !== 'reset' ? (
        <p className={styles.helper}>
          {mode === 'login' ? 'Ще немає акаунту? ' : 'Уже є акаунт? '}
          <Link to={authHref(mode === 'login' ? '/register' : '/login', returnTo)}>
            {mode === 'login' ? 'Створити акаунт' : 'Увійти'}
          </Link>
        </p>
      ) : null}
    </form>
  );
}
