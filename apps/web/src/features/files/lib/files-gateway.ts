export type SavedFormat = 'jpg' | 'png' | 'pdf';
export interface SavedFile {
  id: string;
  name: string;
  format: SavedFormat;
  sizeBytes: number;
  createdAt: string;
}
export interface FilesFilter {
  search: string;
  format: 'all' | SavedFormat;
  order: 'newest' | 'oldest';
}
export interface FilesPageResult {
  files: SavedFile[];
  nextCursor: string | null;
}
// Scope is account-bound. Ownership, cursor validation and byte authorization are server duties.
export interface FilesGateway {
  readonly scope: string;
  list(
    input: FilesFilter & { cursor: string | null },
    signal: AbortSignal,
  ): Promise<FilesPageResult>;
  download(id: string): Promise<{ blob: Blob; name: string }>;
  remove(id: string): Promise<void>;
}
