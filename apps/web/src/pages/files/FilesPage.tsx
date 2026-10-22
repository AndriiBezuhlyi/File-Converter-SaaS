import { ActionLink } from '../../shared/ui/ActionLink';
import { SessionGate } from '../../features/auth/components/SessionGate';
import { AutoSaveSetting } from '../../features/account/components/AutoSaveSetting';
import type { SettingsGateway } from '../../features/account/lib/account-gateway';
import { FilesWorkspace } from '../../features/files/components/FilesWorkspace';
import type { FilesGateway } from '../../features/files/lib/files-gateway';
import styles from './FilesPage.module.scss';

export function FilesPage({
  gateway,
  settingsGateway,
}: {
  gateway?: FilesGateway | undefined;
  settingsGateway?: SettingsGateway | undefined;
}) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 id="files-title" tabIndex={-1}>
          Мої файли
        </h1>
        <ActionLink variant="secondary" to="/">
          До конвертера
        </ActionLink>
      </header>
      <SessionGate available={Boolean(gateway && settingsGateway)} returnTo="/files">
        {gateway && settingsGateway ? (
          <>
            <section className={styles.setting} aria-label="Автозбереження">
              <AutoSaveSetting gateway={settingsGateway} />
            </section>
            <FilesWorkspace gateway={gateway} />
          </>
        ) : null}
      </SessionGate>
    </div>
  );
}
