export interface ApiKeyMetadata {
  prefix: string;
  createdAt: string;
}
// Metadata can be cached; the one-time secret must remain in local component state.
export interface ApiKeyGateway {
  readonly scope: string;
  readKey(signal: AbortSignal): Promise<ApiKeyMetadata | null>;
  createKey(currentPassword: string): Promise<{ metadata: ApiKeyMetadata; secret: string }>;
  rotateKey(currentPassword: string): Promise<{ metadata: ApiKeyMetadata; secret: string }>;
}
