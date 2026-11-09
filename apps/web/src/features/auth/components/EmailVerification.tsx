import { useState } from 'react';
import { Link } from 'react-router';
import { Check, Mail } from 'lucide-react';
import { Button } from '../../../shared/ui/Button';
import { useAuth } from '../lib/auth-context';
import { AuthRequestError } from '../lib/auth-gateway';
import { useAuthAction } from '../lib/use-auth-action';
import { EmailRequestForm } from './EmailRequestForm';
import { authHref } from '../lib/auth-validation';
import { notifyVerification } from '../lib/verification-channel';
import { RegistrationProgress } from './RegistrationProgress';
import styles from './Auth.module.scss';

export function EmailVerification({
  token,
  onTokenUsed,
  returnTo = '/',
}: {
  token: string | null;
  onTokenUsed: () => void;
  returnTo?: string;
}) {
  const { gateway, refreshSession, pendingRegistration } = useAuth();
  const action = useAuthAction();
  const [verified, setVerified] = useState(false);
  if (verified)
    return (
      <div className={styles.section}>
        <p role="status">
          <Check size={24} className={styles.icon} aria-hidden="true" /> Пошту підтверджено. Тепер
          увійдіть до акаунту.
        </p>
        <Link to={authHref('/login', returnTo)}>Увійти</Link>
      </div>
    );
  if (!token && pendingRegistration && gateway?.readRegistrationStatus)
    return (
      <RegistrationProgress
        gateway={gateway}
        registration={pendingRegistration}
        returnTo={returnTo}
      />
    );
  return (
    <div className={styles.section}>
      <Mail size={24} className={styles.icon} aria-hidden="true" />
      {token ? (
        <Button
          disabled={action.pending}
          onClick={() => {
            void action.run(
              async () => {
                if (!gateway) throw new AuthRequestError('unavailable');
                await gateway.verifyEmail(token);
              },
              () => {
                onTokenUsed();
                setVerified(true);
                notifyVerification();
                // Email changes revoke sessions; synchronize only after the token is committed.
                void refreshSession().catch(() => {});
              },
            );
          }}
        >
          {action.pending ? 'Підтверджуємо…' : 'Підтвердити пошту'}
        </Button>
      ) : (
        <p className={styles.helper}>
          Відкрийте посилання з листа. Якщо листа немає, перевірте папку «Спам» або надішліть його
          повторно. Якщо пошту вже підтверджено, перейдіть до входу. Після оновлення сторінки
          автоматична перевірка попередньої спроби не відновлюється.
        </p>
      )}
      {action.error ? (
        <p role="alert" className={styles.error}>
          {action.error}
        </p>
      ) : null}
      <EmailRequestForm purpose="verification" />
      <Link to={authHref('/login', returnTo)}>До входу</Link>
    </div>
  );
}
