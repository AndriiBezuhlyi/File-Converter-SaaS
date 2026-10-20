export type SourceFormat = 'jpg' | 'png' | 'docx';
export type TargetFormat = 'jpg' | 'png' | 'pdf';

// Local UX limit in decimal MB; the future server capabilities remain authoritative.
export const MAX_FILE_SIZE_BYTES = 20_000_000;
export const FILE_ACCEPT = '.jpg,.jpeg,.png,.docx';

const targets: Record<SourceFormat, readonly TargetFormat[]> = {
  jpg: ['png'],
  png: ['jpg'],
  docx: ['pdf'],
};

export interface FileSelection {
  file: File;
  sourceFormat: SourceFormat;
  targetFormat: TargetFormat;
}

type SelectionResult = { ok: true; selection: FileSelection } | { ok: false; error: string };

export function getTargetFormats(source: SourceFormat): readonly TargetFormat[] {
  return targets[source];
}

// Extension checks help selection only; they cannot validate the actual file content.
export function validateFileSelection(files: readonly File[]): SelectionResult {
  if (files.length !== 1) return { ok: false, error: 'Виберіть один файл за раз.' };
  const file = files[0]!;
  if (file.size === 0) return { ok: false, error: 'Файл порожній. Виберіть інший файл.' };
  if (file.size > MAX_FILE_SIZE_BYTES)
    return { ok: false, error: 'Файл завеликий. Максимальний розмір — 20 МБ.' };
  const extension = file.name.split('.').at(-1)?.toLowerCase();
  const sourceFormat = extension === 'jpeg' ? 'jpg' : extension;
  if (
    !file.name.includes('.') ||
    (sourceFormat !== 'jpg' && sourceFormat !== 'png' && sourceFormat !== 'docx')
  ) {
    return { ok: false, error: 'Цей формат не підтримується. Виберіть JPG, PNG або DOCX.' };
  }
  return { ok: true, selection: { file, sourceFormat, targetFormat: targets[sourceFormat][0]! } };
}

const numberFormat = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 });

export function formatFileSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${numberFormat.format(bytes / 1_000_000)} МБ`;
  if (bytes >= 1_000) return `${numberFormat.format(bytes / 1_000)} кБ`;
  return `${numberFormat.format(bytes)} Б`;
}
