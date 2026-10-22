import { ActionLink } from '../../shared/ui/ActionLink';
import { SessionGate } from '../../features/auth/components/SessionGate';
import { ProfileEditor } from '../../features/account/components/ProfileEditor';
import { PasswordEditor } from '../../features/account/components/PasswordEditor';
import { AutoSaveSetting } from '../../features/account/components/AutoSaveSetting';
import { ApiKeyPanel } from '../../features/api-keys/components/ApiKeyPanel';
import type { AccountGateway } from '../../features/account/lib/account-gateway';
import type { ApiKeyGateway } from '../../features/api-keys/lib/api-key-gateway';
import styles from './AccountPage.module.scss';

export function AccountPage({
  gateway,
  keyGateway,
}: {
  gateway?: AccountGateway | undefined;
  keyGateway?: ApiKeyGateway | undefined;
}) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Профіль</h1>
        <ActionLink to="/files" variant="secondary">
          Мої файли
        </ActionLink>
      </header>
      <SessionGate available={Boolean(gateway)} returnTo="/account">
        {gateway ? (
          <>
            <div className={styles.columns}>
              <section aria-labelledby="profile-heading">
                <h2 id="profile-heading">Особисті дані</h2>
                <ProfileEditor gateway={gateway} />
              </section>
              <section aria-labelledby="password-heading">
                <h2 id="password-heading">Зміна пароля</h2>
                <PasswordEditor gateway={gateway} />
              </section>
            </div>
            <section className={styles.section} aria-labelledby="save-heading">
              <h2 id="save-heading">Автозбереження</h2>
              <AutoSaveSetting gateway={gateway} />
            </section>
            <section className={styles.section} aria-labelledby="key-heading">
              <h2 id="key-heading">API-ключ</h2>
              {keyGateway ? (
                <ApiKeyPanel gateway={keyGateway} />
              ) : (
                <p>Керування API-ключем ще не підключено.</p>
              )}
            </section>
          </>
        ) : null}
      </SessionGate>
    </div>
  );
}
