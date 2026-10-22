import { useEffect, useId, useState } from 'react';
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { Field } from '../../../shared/ui/Field';
import { Button } from '../../../shared/ui/Button';
import { Dialog } from '../../../shared/ui/Dialog';
import { useRequestAction } from '../../../shared/lib/use-request-action';
import { DataAccessError, dataErrorMessage } from '../../../shared/lib/data-access-error';
import { saveDownload } from '../../../shared/lib/save-download';
import type { FilesFilter, FilesGateway, FilesPageResult, SavedFile } from '../lib/files-gateway';
import styles from './Files.module.scss';

function fileDate(value: string) {
  return new Date(value).toLocaleString('uk-UA');
}
function fileSize(value: number) {
  return `${value.toLocaleString('uk-UA')} Б`;
}
export function FilesWorkspace({ gateway }: { gateway: FilesGateway }) {
  const formatId = useId();
  const orderId = useId();
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [format, setFormat] = useState<FilesFilter['format']>('all');
  const [order, setOrder] = useState<FilesFilter['order']>('newest');
  const [modal, setModal] = useState<{ kind: 'details' | 'delete'; file: SavedFile } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const action = useRequestAction(dataErrorMessage);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  const filters = { search: debounced, format, order };
  const query = useInfiniteQuery({
    queryKey: ['files', gateway.scope, 'list', filters],
    queryFn: ({ pageParam, signal }) => gateway.list({ ...filters, cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last, _pages, _lastParam, params) =>
      last.nextCursor && !params.includes(last.nextCursor) ? last.nextCursor : null,
    retry: false,
  });
  const files = [
    ...new Map(
      query.data?.pages.flatMap((page) => page.files).map((file) => [file.id, file]),
    ).values(),
  ];
  const searching = search.trim() !== debounced;
  function resetFilters() {
    setSearch('');
    setDebounced('');
    setFormat('all');
    setOrder('newest');
  }
  function deleted(id: string) {
    client.setQueriesData<InfiniteData<FilesPageResult>>(
      { queryKey: ['files', gateway.scope, 'list'] },
      (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((page) => ({
                ...page,
                files: page.files.filter((file) => file.id !== id),
              })),
            }
          : old,
    );
    void client.invalidateQueries({ queryKey: ['files', gateway.scope] });
    setModal(null);
    setNotice('Файл видалено.');
    window.requestAnimationFrame(() => document.getElementById('files-title')?.focus());
  }
  return (
    <div className={styles.workspace}>
      <div className={styles.filters}>
        <Field
          label="Пошук за назвою"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className={styles.selectLabel}>
          <label htmlFor={formatId}>Тип файлу</label>
          <select
            id={formatId}
            value={format}
            onChange={(event) => {
              const value = event.target.value;
              if (value === 'all' || value === 'jpg' || value === 'png' || value === 'pdf')
                setFormat(value);
            }}
          >
            <option value="all">Усі</option>
            <option value="jpg">JPG</option>
            <option value="png">PNG</option>
            <option value="pdf">PDF</option>
          </select>
        </div>
        <div className={styles.selectLabel}>
          <label htmlFor={orderId}>За датою</label>
          <select
            id={orderId}
            value={order}
            onChange={(event) => setOrder(event.target.value === 'oldest' ? 'oldest' : 'newest')}
          >
            <option value="newest">Спочатку нові</option>
            <option value="oldest">Спочатку старі</option>
          </select>
        </div>
      </div>
      {notice ? <p role="status">{notice}</p> : null}
      {query.isError ? (
        <div>
          <p role="alert">{dataErrorMessage(query.error)}</p>
          <Button
            variant="secondary"
            onClick={() => {
              void query.refetch();
            }}
          >
            Оновити список
          </Button>
        </div>
      ) : null}
      {query.isPending || searching ? (
        <p role="status">{searching ? 'Оновлюємо пошук…' : 'Завантажуємо файли…'}</p>
      ) : null}
      {!query.isPending && !query.isError && !searching && files.length === 0 ? (
        <div className={styles.empty}>
          <h2>
            {debounced || format !== 'all' ? 'Нічого не знайдено' : 'Ще немає збережених файлів'}
          </h2>
          <p>
            {debounced || format !== 'all'
              ? 'Спробуйте іншу назву або тип файлу.'
              : 'Тут з’являться нові результати конвертацій з увімкненим автозбереженням.'}
          </p>
          {debounced || format !== 'all' ? (
            <Button variant="secondary" onClick={resetFilters}>
              Скинути фільтри
            </Button>
          ) : null}
        </div>
      ) : null}
      {!searching ? (
        <ul className={styles.list} aria-label="Збережені файли">
          {files.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              gateway={gateway}
              onDetails={() => {
                action.clearError();
                setModal({ kind: 'details', file });
              }}
              onDelete={() => {
                action.clearError();
                setModal({ kind: 'delete', file });
              }}
              onDenied={() => {
                setNotice('Файл більше недоступний для завантаження. Список оновлюється.');
                void client.invalidateQueries({ queryKey: ['files', gateway.scope] });
              }}
            />
          ))}
        </ul>
      ) : null}
      {query.hasNextPage && !searching ? (
        <Button
          variant="secondary"
          className={styles.more}
          disabled={query.isFetching}
          onClick={() => {
            void query.fetchNextPage({ cancelRefetch: false });
          }}
        >
          {query.isFetchingNextPage ? 'Завантажуємо…' : 'Показати ще'}
        </Button>
      ) : null}
      {modal ? (
        <Dialog
          title={modal.kind === 'details' ? 'Деталі файлу' : 'Видалити файл?'}
          onClose={() => setModal(null)}
          pending={action.pending}
        >
          <div className={styles.dialogContent}>
            <p className={styles.fileName}>{modal.file.name}</p>
            {modal.kind === 'details' ? (
              <>
                <dl className={styles.details}>
                  <div>
                    <dt>Тип</dt>
                    <dd>{modal.file.format.toUpperCase()}</dd>
                  </div>
                  <div>
                    <dt>Розмір</dt>
                    <dd>{fileSize(modal.file.sizeBytes)}</dd>
                  </div>
                  <div>
                    <dt>Дата</dt>
                    <dd>{fileDate(modal.file.createdAt)}</dd>
                  </div>
                </dl>
                <p>Збережений результат конвертації.</p>
              </>
            ) : (
              <p>Файл стане недоступним для завантаження.</p>
            )}
            <div className={styles.actions}>
              {modal.kind === 'delete' ? (
                <Button
                  variant="danger"
                  disabled={action.pending}
                  onClick={() => {
                    const id = modal.file.id;
                    void action.run(
                      async () => {
                        await gateway.remove(id);
                        await client.cancelQueries({ queryKey: ['files', gateway.scope] });
                      },
                      () => deleted(id),
                    );
                  }}
                >
                  {action.pending ? 'Видаляємо…' : 'Видалити файл'}
                </Button>
              ) : null}
              <Button
                variant="secondary"
                data-initial-focus
                disabled={action.pending}
                onClick={() => setModal(null)}
              >
                {modal.kind === 'delete' ? 'Скасувати' : 'Закрити'}
              </Button>
            </div>
            {modal.kind === 'delete' && action.error ? (
              <p role="alert" className={styles.error}>
                {action.error}
              </p>
            ) : null}
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
function FileRow({
  file,
  gateway,
  onDetails,
  onDelete,
  onDenied,
}: {
  file: SavedFile;
  gateway: FilesGateway;
  onDetails: () => void;
  onDelete: () => void;
  onDenied: () => void;
}) {
  const action = useRequestAction(dataErrorMessage);
  const [denied, setDenied] = useState(false);
  return (
    <li className={styles.row}>
      <article aria-label={file.name}>
        <h2 className={styles.fileName}>{file.name}</h2>
        <dl className={styles.metadata}>
          <div>
            <dt>Тип</dt>
            <dd className={styles[file.format]}>{file.format.toUpperCase()}</dd>
          </div>
          <div>
            <dt>Розмір</dt>
            <dd>{fileSize(file.sizeBytes)}</dd>
          </div>
          <div>
            <dt>Дата</dt>
            <dd>
              <time dateTime={file.createdAt}>{fileDate(file.createdAt)}</time>
            </dd>
          </div>
        </dl>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={onDetails}>
            Деталі
          </Button>
          {!denied ? (
            <Button
              variant="secondary"
              disabled={action.pending}
              onClick={() => {
                void action.run(
                  () => gateway.download(file.id),
                  (result) => saveDownload(result.blob, result.name),
                  (cause) => {
                    if (
                      cause instanceof DataAccessError &&
                      ['not-found', 'expired', 'unauthorized'].includes(cause.kind)
                    ) {
                      setDenied(true);
                      onDenied();
                    }
                  },
                );
              }}
            >
              {action.pending ? 'Завантажуємо…' : 'Завантажити'}
            </Button>
          ) : null}
          <Button variant="danger" onClick={onDelete}>
            Видалити
          </Button>
        </div>
        {action.error ? (
          <p role="alert" className={styles.error}>
            {action.error}
          </p>
        ) : null}
      </article>
    </li>
  );
}
