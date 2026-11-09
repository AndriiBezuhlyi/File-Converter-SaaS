export const MAX_UPLOAD_BYTES = 20_000_000;
export const MAX_IMAGE_PIXELS = 40_000_000;
export const MAX_ARCHIVE_BYTES = 80_000_000;
export const MAX_ARCHIVE_ENTRIES = 1_000;
export const CONVERSION_DIRECTIONS = {
  jpg: ['png', 'webp', 'avif'],
  png: ['jpg', 'webp', 'avif'],
  webp: ['jpg', 'png', 'avif'],
  avif: ['jpg', 'png', 'webp'],
  gif: ['jpg', 'png', 'webp', 'avif'],
  svg: ['jpg', 'png', 'webp', 'avif'],
  docx: ['pdf'],
  odt: ['pdf'],
  xlsx: ['pdf'],
  pptx: ['pdf'],
  csv: ['pdf'],
  txt: ['pdf'],
} as const;
export type SourceFormat = keyof typeof CONVERSION_DIRECTIONS;
export type TargetFormat = 'jpg' | 'png' | 'webp' | 'avif' | 'pdf';
export const INPUT_MIME = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv',
  txt: 'text/plain',
} as const;
