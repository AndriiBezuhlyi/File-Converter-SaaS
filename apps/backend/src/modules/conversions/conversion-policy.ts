export const MAX_UPLOAD_BYTES = 20_000_000;
export const MAX_IMAGE_PIXELS = 40_000_000;
export const MAX_ARCHIVE_BYTES = 80_000_000;
export const MAX_ARCHIVE_ENTRIES = 1_000;
export const CONVERSION_DIRECTIONS = { jpg: ['png'], png: ['jpg'], docx: ['pdf'] } as const;
export type SourceFormat = keyof typeof CONVERSION_DIRECTIONS;
export type TargetFormat = 'jpg' | 'png' | 'pdf';
export const INPUT_MIME = {
  jpg: 'image/jpeg',
  png: 'image/png',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const;
