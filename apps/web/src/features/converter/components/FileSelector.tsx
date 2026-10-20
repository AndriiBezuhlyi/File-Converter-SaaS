import { useEffect, useId, useRef, useState, type DragEvent } from 'react';
import { AlertCircle, ArrowRight, FileImage, FileText, Upload, X } from 'lucide-react';
import { Button } from '../../../shared/ui/Button';
import { Surface } from '../../../shared/ui/Surface';
import {
  FILE_ACCEPT,
  formatFileSize,
  getTargetFormats,
  validateFileSelection,
  type FileSelection,
} from '../lib/file-selection';
import styles from './FileSelector.module.scss';

export function FileSelector() {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLButtonElement>(null);
  const dragDepth = useRef(0);
  const [selection, setSelection] = useState<FileSelection | null>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const headingId = `${id}-heading`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const targetId = `${id}-target`;
  const availabilityId = `${id}-availability`;
  const descriptions = [hintId, error ? errorId : ''].filter(Boolean).join(' ');
  const availableTargets = selection ? getTargetFormats(selection.sourceFormat) : [];
  const FileIcon = selection?.sourceFormat === 'docx' ? FileText : FileImage;

  useEffect(() => {
    function preventFileNavigation(event: globalThis.DragEvent) {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      if (event.type === 'drop') {
        dragDepth.current = 0;
        setDragging(false);
      }
    }
    window.addEventListener('dragover', preventFileNavigation);
    window.addEventListener('drop', preventFileNavigation);
    return () => {
      window.removeEventListener('dragover', preventFileNavigation);
      window.removeEventListener('drop', preventFileNavigation);
    };
  }, []);

  function selectFiles(files: readonly File[]) {
    const result = validateFileSelection(files);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSelection(result.selection);
    setError('');
    setAnnouncement(
      `Вибрано файл ${result.selection.file.name}. Вихідний формат — ${result.selection.targetFormat.toUpperCase()}.`,
    );
  }

  function resetDrag() {
    dragDepth.current = 0;
    setDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    resetDrag();
    const containsDirectory = Array.from(event.dataTransfer.items).some(
      (item) => item.kind === 'file' && item.webkitGetAsEntry?.()?.isDirectory,
    );
    if (containsDirectory) {
      setError('Виберіть один файл, а не папку.');
      return;
    }
    selectFiles(Array.from(event.dataTransfer.files));
  }

  function removeFile() {
    setSelection(null);
    setError('');
    setAnnouncement('Файл прибрано. Виберіть інший файл.');
    if (input.current) input.current.value = '';
    picker.current?.focus();
  }

  return (
    <Surface aria-labelledby={headingId}>
      <p className={styles.annotation}>{'{ Конвертер }'}</p>
      <h2 className={styles.heading} id={headingId}>
        Один файл. Інший формат.
      </h2>
      <input
        ref={input}
        type="file"
        hidden
        accept={FILE_ACCEPT}
        aria-label="Файл для конвертації"
        aria-describedby={descriptions}
        aria-invalid={error ? true : undefined}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          if (files.length) selectFiles(files);
        }}
      />
      <div
        className={styles.dropzone}
        role="group"
        aria-label="Область вибору файлу"
        data-dragging={dragging}
        data-error={Boolean(error)}
        onDragEnter={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={handleDrop}
      >
        {selection ? (
          <div className={styles.file}>
            <FileIcon
              size={24}
              strokeWidth={1.75}
              className={styles[selection.sourceFormat]}
              aria-hidden="true"
            />
            <div className={styles.fileText}>
              <strong className={styles.filename}>{selection.file.name}</strong>
              <div className={styles.metadata}>
                <span className={`${styles.format} ${styles[selection.sourceFormat]}`}>
                  {selection.sourceFormat.toUpperCase()}
                </span>
                <span>{formatFileSize(selection.file.size)}</span>
              </div>
            </div>
            <Button
              variant="secondary"
              className={styles.remove}
              aria-label="Прибрати файл"
              onClick={removeFile}
            >
              <X size={20} strokeWidth={1.75} aria-hidden="true" />
            </Button>
          </div>
        ) : (
          <>
            <Upload size={28} strokeWidth={1.75} aria-hidden="true" />
            <p className={styles.dropTitle}>Перетягніть файл сюди</p>
          </>
        )}
        <p className={styles.hint} id={hintId}>
          JPG, PNG або DOCX · до 20 МБ
        </p>
        <Button
          ref={picker}
          variant={selection ? 'secondary' : 'primary'}
          onClick={() => input.current?.click()}
          aria-describedby={descriptions}
        >
          {selection ? 'Змінити файл' : 'Вибрати файл'}
        </Button>
      </div>
      {error ? (
        <div id={errorId} className={styles.error} role="alert">
          <AlertCircle size={20} strokeWidth={1.75} aria-hidden="true" />
          <p>
            {error}
            {selection ? ' Попередній вибір збережено.' : ''}
          </p>
        </div>
      ) : null}
      <div className={styles.target}>
        <label className={styles.label} htmlFor={targetId}>
          Конвертувати у
        </label>
        <select
          className={styles.select}
          id={targetId}
          disabled={!selection}
          value={selection?.targetFormat ?? ''}
          onChange={(event) => {
            const target = availableTargets.find((format) => format === event.currentTarget.value);
            if (selection && target) setSelection({ ...selection, targetFormat: target });
          }}
        >
          {!selection ? (
            <option value="">Спочатку виберіть файл</option>
          ) : (
            availableTargets.map((format) => (
              <option key={format} value={format}>
                {format.toUpperCase()}
              </option>
            ))
          )}
        </select>
      </div>
      <Button className={styles.convert} disabled aria-describedby={availabilityId}>
        Конвертувати
        <ArrowRight size={20} strokeWidth={1.75} aria-hidden="true" />
      </Button>
      <p className={styles.availability} id={availabilityId}>
        Наразі доступний вибір файлу. Конвертація — незабаром.
      </p>
      <p className="sr-only" role="status">
        {announcement}
      </p>
    </Surface>
  );
}
