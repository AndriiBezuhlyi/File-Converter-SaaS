import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { CredentialsForm } from '../../features/auth/components/CredentialsForm';
import { EmailRequestForm } from '../../features/auth/components/EmailRequestForm';
import { EmailVerification } from '../../features/auth/components/EmailVerification';
import { useAuth } from '../../features/auth/lib/auth-context';
import { authHref, safeReturnTo } from '../../features/auth/lib/auth-validation';
import styles from './AuthPage.module.scss';

export type AuthPageKind =
  'login' | 'register' | 'verify-email' | 'forgot-password' | 'reset-password';
const content = {
  login: ['Увійти', 'Увійдіть, щоб продовжити конвертації.'],
  register: ['Створити акаунт', 'Зареєструйтеся через пошту. Після реєстрації підтвердьте адресу.'],
  'verify-email': ['Підтвердження пошти', 'Перевірте вхідні та папку «Спам».'],
  'forgot-password': ['Відновлення пароля', 'Надішлемо посилання для зміни пароля.'],
  'reset-password': ['Новий пароль', 'Встановіть новий пароль для свого акаунту.'],
} as const;

function readLinkToken(search: string) {
  const value = new URLSearchParams(search).get('token');
  return value && /^[a-zA-Z0-9._~-]{1,2048}$/.test(value) ? value : null;
}

export function AuthPage({ kind }: { kind: AuthPageKind }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { gateway, session } = useAuth();
  const search = new URLSearchParams(location.search);
  const returnTo = safeReturnTo(search.get('returnTo'));
  const isLinkPage = kind === 'verify-email' || kind === 'reset-password';
  const [link, setLink] = useState(() => ({
    search: location.search,
    token: isLinkPage ? readLinkToken(location.search) : null,
    version: 0,
  }));
  // A new email link can arrive on the same mounted route. Capture it before scrubbing;
  // the subsequent URL replacement preserves the in-memory credential and form state.
  if (isLinkPage && link.search !== location.search) {
    const hasToken = search.has('token');
    setLink({
      search: location.search,
      token: hasToken ? readLinkToken(location.search) : link.token,
      version: link.version + (hasToken ? 1 : 0),
    });
  }
  const consumeToken = () => setLink({ ...link, token: null });
  // Retain the link credential in component memory only; scrub it before any user action.
  useEffect(() => {
    if (
      (kind === 'verify-email' || kind === 'reset-password') &&
      new URLSearchParams(location.search).has('token')
    ) {
      void navigate(authHref(`/${kind}`, returnTo), { replace: true });
    }
  }, [kind, location.search, navigate, returnTo]);
  const [title, description] = content[kind];
  return (
    <section className={styles.page} aria-labelledby="auth-title">
      <header className={styles.intro}>
        <h1 id="auth-title">{title}</h1>
        <p>{description}</p>
      </header>
      {session?.kind === 'authenticated' && (kind === 'login' || kind === 'register') ? (
        <div className={styles.notice}>
          <p role="status">Ви вже увійшли до акаунту.</p>
          <Link to={returnTo}>Продовжити</Link>
        </div>
      ) : kind === 'verify-email' ? (
        <EmailVerification key={link.version} token={link.token} onTokenUsed={consumeToken} />
      ) : kind === 'forgot-password' ? (
        <EmailRequestForm purpose="recovery" />
      ) : (
        <CredentialsForm
          key={link.version}
          mode={kind === 'reset-password' ? 'reset' : kind}
          returnTo={returnTo}
          token={link.token}
          onTokenUsed={consumeToken}
        />
      )}
      {kind !== 'login' && kind !== 'register' ? (
        <Link to={authHref('/login', returnTo)}>До входу</Link>
      ) : null}
      <div className={styles.notice}>
        {!gateway ? <p>Авторизацію ще не підключено. Дані нікуди не надсилаються.</p> : null}
        {returnTo.includes('conversion=') ? (
          <p>
            Після переходу виберіть файл повторно. Вхід не зберігає гостьовий результат в акаунті.
          </p>
        ) : null}
        <Link to={returnTo.startsWith('/?conversion=') ? returnTo : '/'}>До конвертера</Link>
      </div>
    </section>
  );
}
