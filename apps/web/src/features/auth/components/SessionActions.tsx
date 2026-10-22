import { Link, useNavigate } from 'react-router';
import { Button } from '../../../shared/ui/Button';
import { useAuth } from '../lib/auth-context';
import { useAuthAction } from '../lib/use-auth-action';
import styles from './Auth.module.scss';

export function SessionActions() {
  const { gateway, session, status, refreshSession } = useAuth();
  const action = useAuthAction();
  const navigate = useNavigate();
  if (status === 'pending')
    return (
      <span className={styles.helper} role="status">
        Перевіряємо вхід…
      </span>
    );
  if (status === 'error')
    return (
      <div className={styles.feedback}>
        <span role="status" className={styles.helper}>
          Не вдалося перевірити вхід.
        </span>
        <Button
          variant="secondary"
          disabled={action.pending}
          onClick={() => {
            void action.run(refreshSession, () => {});
          }}
        >
          Спробувати ще раз
        </Button>
        {action.error ? (
          <span role="alert" className={styles.error}>
            {action.error}
          </span>
        ) : null}
      </div>
    );
  if (session?.kind !== 'authenticated') return null;
  return (
    <div className={styles.feedback}>
      <div className={styles.sessionLinks}>
        <Link to="/files">Мої файли</Link>
        <Link to="/account">Профіль</Link>
        <Button
          variant="secondary"
          disabled={action.pending}
          onClick={() => {
            void action.run(
              async () => {
                await gateway!.signOut();
                await refreshSession();
              },
              () => {
                void navigate('/login');
              },
            );
          }}
        >
          {action.pending ? 'Виходимо…' : 'Вийти'}
        </Button>
      </div>
      {action.error ? (
        <span role="alert" className={styles.error}>
          {action.error}
        </span>
      ) : null}
    </div>
  );
}
