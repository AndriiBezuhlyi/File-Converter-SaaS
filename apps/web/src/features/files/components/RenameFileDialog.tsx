import { useState } from 'react';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { Dialog } from '../../../shared/ui/Dialog';
import { Field } from '../../../shared/ui/Field';
import { Button } from '../../../shared/ui/Button';
import { useRequestAction } from '../../../shared/lib/use-request-action';
import { DataAccessError, dataErrorMessage } from '../../../shared/lib/data-access-error';
import type { FilesGateway, FilesPageResult, SavedFile } from '../lib/files-gateway';
import styles from './Files.module.scss';

export function RenameFileDialog({
  file,
  gateway,
  onClose,
}: {
  file: SavedFile;
  gateway: FilesGateway;
  onClose: () => void;
}) {
  const extension = file.name.slice(file.name.lastIndexOf('.'));
  const [base, setBase] = useState(file.name.slice(0, -extension.length));
  const client = useQueryClient();
  const action = useRequestAction((error) =>
    error instanceof DataAccessError && error.kind === 'rejected'
      ? 'Не вдалося перейменувати файл. Перевірте назву та спробуйте ще раз.'
      : dataErrorMessage(error),
  );
  const valid =
    Boolean(base.trim()) &&
    !/[\p{Cc}\p{Cf}<>:"/\\|?*]/u.test(base) &&
    !/[. ]$/.test(base) &&
    !/^[. ]+$/.test(base);
  return (
    <Dialog title="Перейменувати файл" onClose={onClose} pending={action.pending}>
      <form
        className={styles.dialogContent}
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid || !gateway.rename) return;
          void action.run(async () => {
            const updated = await gateway.rename!(file.id, `${base.trim()}${extension}`);
            await client.cancelQueries({ queryKey: ['files', gateway.scope] });
            client.setQueriesData<InfiniteData<FilesPageResult>>(
              { queryKey: ['files', gateway.scope, 'list'] },
              (old) =>
                old
                  ? {
                      ...old,
                      pages: old.pages.map((page) => ({
                        ...page,
                        files: page.files.map((item) => (item.id === updated.id ? updated : item)),
                      })),
                    }
                  : old,
            );
            await Promise.all([
              client.invalidateQueries({ queryKey: ['files', gateway.scope] }),
              client.invalidateQueries({ queryKey: ['converter'] }),
            ]);
          }, onClose);
        }}
      >
        <Field
          label="Назва файлу"
          value={base}
          required
          maxLength={200 - extension.length}
          data-initial-focus
          disabled={action.pending}
          onChange={(event) => {
            setBase(event.target.value);
            action.clearError();
          }}
          hint={`Розширення ${extension} залишиться незмінним. Не використовуйте символи < > : " / \\ | ? *.`}
        />
        <div className={styles.actions}>
          <Button type="submit" disabled={action.pending || !valid}>
            {action.pending ? 'Зберігаємо…' : 'Зберегти назву'}
          </Button>
          <Button variant="secondary" disabled={action.pending} onClick={onClose}>
            Скасувати
          </Button>
        </div>
        {action.error ? (
          <p role="alert" className={styles.error}>
            {action.error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
