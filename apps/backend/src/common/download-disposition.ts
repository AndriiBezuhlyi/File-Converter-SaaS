import { toUSVString } from 'node:util';

export function downloadDisposition(name: string): string {
  const extension = /\.(jpg|png|webp|avif|pdf)$/i.exec(name)?.[1]?.toLowerCase() ?? 'bin';
  const safe =
    Array.from(toUSVString(name).replace(/[\p{Cc}\p{Cf}\\/]/gu, '_'))
      .slice(0, 200)
      .join('')
      .trim() || `conversion.${extension}`;
  const encoded = encodeURIComponent(safe).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="conversion.${extension}"; filename*=UTF-8''${encoded}`;
}
