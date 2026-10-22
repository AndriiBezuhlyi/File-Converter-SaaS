import type { PropsWithChildren } from 'react';
import { Link } from 'react-router';
import { Button } from '../../../shared/ui/Button';
import { useAuth } from '../lib/auth-context';
import { useAuthAction } from '../lib/use-auth-action';
import { authHref } from '../lib/auth-validation';

export function SessionGate({
  available,
  returnTo,
  children,
}: PropsWithChildren<{ available: boolean; returnTo: '/account' | '/files' }>) {
  const { session, status, refreshSession } = useAuth();
  const action = useAuthAction();
  if (status === 'pending') return <p role="status">Перевіряємо вхід…</p>;
  if (status === 'error')
    return (
      <div>
        <p role="status">Не вдалося перевірити вхід.</p>
        <Button
          disabled={action.pending}
          onClick={() => {
            void action.run(refreshSession, () => {});
          }}
        >
          Перевірити вхід ще раз
        </Button>
      </div>
    );
  if (status === 'unavailable' || !available)
    return (
      <div>
        <p>Цей розділ ще не підключено. Дані акаунту наразі недоступні.</p>
        <Link to={authHref('/login', returnTo)}>До входу</Link>
      </div>
    );
  if (session?.kind !== 'authenticated')
    return (
      <div>
        <p>Увійдіть до акаунту, щоб відкрити цей розділ.</p>
        <Link to={authHref('/login', returnTo)}>Увійти до акаунту</Link>
      </div>
    );
  return children;
}
