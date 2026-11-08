import { Link } from 'react-router';
import { Check } from 'lucide-react';
import { Button } from '../../../shared/ui/Button';
import type { AuthGateway, PendingRegistration } from '../lib/auth-gateway';
import { authHref } from '../lib/auth-validation';
import { useRegistrationStatus } from '../lib/use-registration-status';
import { EmailRequestForm } from './EmailRequestForm';
import styles from './Auth.module.scss';

export function RegistrationProgress({
  gateway,
  registration,
  returnTo,
}: {
  gateway: AuthGateway;
  registration: PendingRegistration;
  returnTo: string;
}) {
  const { status, checking, error, recheck } = useRegistrationStatus(gateway, registration);
  return (
    <div className={styles.section}>
      <p role="status" className={status === 'verified' ? styles.success : styles.helper}>
        {status === 'verified' ? (
          <>
            <Check size={24} className={styles.icon} aria-hidden="true" /> Пошту підтверджено. Тепер
            увійдіть до акаунту.
          </>
        ) : status === 'expired' ? (
          'Строк перевірки цієї реєстрації завершився. Якщо вже підтвердили пошту, увійдіть. Інакше надішліть лист повторно.'
        ) : (
          'Відкрийте посилання з листа та підтвердьте пошту. Ця вкладка перевірятиме результат автоматично протягом 15 хвилин.'
        )}
      </p>
      {status === 'pending' ? (
        <Button variant="secondary" disabled={checking} onClick={recheck}>
          {checking ? 'Перевіряємо…' : 'Перевірити підтвердження'}
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className={styles.error}>
          {error} Підтвердження могло вже відбутися; перевірте ще раз.
        </p>
      ) : null}
      <Link to={authHref('/login', returnTo)}>Увійти</Link>
      {status !== 'verified' ? <EmailRequestForm purpose="verification" /> : null}
    </div>
  );
}
