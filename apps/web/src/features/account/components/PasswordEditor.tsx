import { useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '../../../shared/ui/Button';
import { PasswordField } from '../../auth/components/PasswordField';
import { useAuth } from '../../auth/lib/auth-context';
import { useRequestAction } from '../../../shared/lib/use-request-action';
import { dataErrorMessage } from '../../../shared/lib/data-access-error';
import type { AccountGateway } from '../lib/account-gateway';
import { changePasswordSchema } from '../lib/account-validation';
import styles from './Account.module.scss';

export function PasswordEditor({ gateway }: { gateway: AccountGateway }) {
  const { refreshSession } = useAuth();
  const navigate = useNavigate();
  const action = useRequestAction(dataErrorMessage);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmation: '' },
  });
  return (
    <form
      className={styles.form}
      noValidate
      aria-label="Зміна пароля"
      aria-busy={action.pending}
      onSubmit={(event) => {
        void handleSubmit(async ({ currentPassword, newPassword }) => {
          await action.run(
            () => gateway.changePassword({ currentPassword, newPassword }),
            () => {
              reset();
              void refreshSession().catch(() => {});
              void navigate('/login', { state: { notice: 'password-changed' } });
            },
          );
        })(event);
      }}
    >
      <fieldset className={styles.fieldset} disabled={action.pending}>
        <PasswordField
          label="Поточний пароль"
          autoComplete="current-password"
          {...register('currentPassword')}
          error={errors.currentPassword?.message}
        />
        <PasswordField
          label="Новий пароль"
          autoComplete="new-password"
          hint="Від 8 до 128 символів. Пробіли враховуються."
          {...register('newPassword')}
          error={errors.newPassword?.message}
        />
        <PasswordField
          label="Повторіть новий пароль"
          autoComplete="new-password"
          {...register('confirmation')}
          error={errors.confirmation?.message}
        />
        <Button type="submit">{action.pending ? 'Змінюємо…' : 'Змінити пароль'}</Button>
      </fieldset>
      {action.error ? (
        <p role="alert" className={styles.error}>
          {action.error}
        </p>
      ) : null}
    </form>
  );
}
