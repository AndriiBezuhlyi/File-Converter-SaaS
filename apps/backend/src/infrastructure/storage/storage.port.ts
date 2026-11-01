import type { Readable } from 'node:stream';

export interface StoredObject {
  body: Readable;
  sizeBytes: number | undefined;
  contentType: string | undefined;
}
export interface StoragePort {
  createKey(purpose: 'inputs' | 'outputs'): string;
  put(
    key: string,
    body: Readable | Uint8Array,
    contentType: string,
    sizeBytes: number,
  ): Promise<void>;
  get(key: string): Promise<StoredObject>;
  head(key: string): Promise<{ sizeBytes: number | undefined; contentType: string | undefined }>;
  remove(key: string): Promise<void>;
}
