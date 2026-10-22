import { useState } from 'react';
import { Check, Mail } from 'lucide-react';
import { Button } from '../../../shared/ui/Button';
import { useAuth } from '../lib/auth-context';
import { AuthRequestError } from '../lib/auth-gateway';
import { useAuthAction } from '../lib/use-auth-action';
import { EmailRequestForm } from './EmailRequestForm';
import styles from './Auth.module.scss';

export function EmailVerification({
  token,
  onTokenUsed,
}: {
  token: string | null;
  onTokenUsed: () => void;
}) {
  const { gateway } = useAuth();
  const action = useAuthAction();
  const [verified, setVerified] = useState(false);
  if (verified)
    return (
      <p role="status">
        <Check size={24} className={styles.icon} aria-hidden="true" /> Пошту підтверджено. Тепер
        увійдіть до акаунту.
      </p>
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
              },
            );
          }}
        >
          {action.pending ? 'Підтверджуємо…' : 'Підтвердити пошту'}
        </Button>
      ) : (
        <p className={styles.helper}>
          Відкрийте посилання з листа. Якщо листа немає, перевірте папку «Спам» або надішліть його
          повторно.
        </p>
      )}
      {action.error ? (
        <p role="alert" className={styles.error}>
          {action.error}
        </p>
      ) : null}
      <EmailRequestForm purpose="verification" />
    </div>
  );
}
