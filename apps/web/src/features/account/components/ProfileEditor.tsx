import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Field } from '../../../shared/ui/Field';
import { Button } from '../../../shared/ui/Button';
import { useRequestAction } from '../../../shared/lib/use-request-action';
import { dataErrorMessage } from '../../../shared/lib/data-access-error';
import { PasswordField } from '../../auth/components/PasswordField';
import type { AccountGateway, AccountProfile } from '../lib/account-gateway';
import { profileQuery } from '../lib/account-queries';
import { profileSchema } from '../lib/account-validation';
import styles from './Account.module.scss';

export function ProfileEditor({ gateway }: { gateway: AccountGateway }) {
  const profile = useQuery(profileQuery(gateway));
  if (profile.isPending) return <p role="status">Завантажуємо профіль…</p>;
  if (profile.isError)
    return (
      <div>
        <p role="alert">{dataErrorMessage(profile.error)}</p>
        <Button
          onClick={() => {
            void profile.refetch();
          }}
        >
          Повторити завантаження профілю
        </Button>
      </div>
    );
  return <ProfileForm key={profile.data.email} gateway={gateway} profile={profile.data} />;
}
function ProfileForm({ gateway, profile }: { gateway: AccountGateway; profile: AccountProfile }) {
  const client = useQueryClient();
  const action = useRequestAction(dataErrorMessage);
  const [message, setMessage] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(profileSchema),
    defaultValues: { ...profile, currentPassword: '' },
  });
  return (
    <form
      className={styles.form}
      noValidate
      aria-label="Особисті дані"
      aria-busy={action.pending}
      onSubmit={(event) => {
        void handleSubmit(async (data) => {
          setMessage(null);
          await action.run(
            async () => {
              const result = await gateway.updateProfile(data);
              await client.cancelQueries({ queryKey: profileQuery(gateway).queryKey });
              return result;
            },
            (result) => {
              client.setQueryData(profileQuery(gateway).queryKey, result.profile);
              reset({ ...result.profile, currentPassword: '' });
              setMessage(
                result.verificationRequired
                  ? 'Перевірте пошту, щоб підтвердити зміну адреси.'
                  : 'Особисті дані збережено.',
              );
            },
          );
        })(event);
      }}
    >
      <fieldset className={styles.fieldset} disabled={action.pending}>
        <Field
          label="Ім’я"
          autoComplete="name"
          hint="Необов’язково."
          {...register('displayName')}
          error={errors.displayName?.message}
        />
        <Field
          label="Електронна пошта"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          {...register('email')}
          error={errors.email?.message}
        />
        <PasswordField
          label="Поточний пароль"
          autoComplete="current-password"
          hint="Підтвердьте зміни поточним паролем."
          {...register('currentPassword')}
          error={errors.currentPassword?.message}
        />
        <Button type="submit">{action.pending ? 'Зберігаємо…' : 'Зберегти дані'}</Button>
      </fieldset>
      {message ? (
        <p role="status" className={styles.feedback}>
          {message}
        </p>
      ) : null}
      {action.error ? (
        <p role="alert" className={`${styles.feedback} ${styles.error}`}>
          {action.error}
        </p>
      ) : null}
    </form>
  );
}
