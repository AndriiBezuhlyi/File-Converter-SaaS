function safeName(value: string): string {
  const name =
    value
      .split(/[\\/]/)
      .at(-1)
      ?.replace(/[\p{Cc}\p{Cf}]/gu, '')
      .trim() ?? '';
  return name && name !== '.' && name !== '..' ? name.slice(0, 255) : '';
}

export function downloadName(disposition: unknown, fallback: string): string {
  if (typeof disposition === 'string' && disposition.length <= 4_096) {
    const extended = /(?:^|;)\s*filename\*\s*=\s*UTF-8''([^;]*)/i.exec(disposition);
    if (extended?.[1]) {
      try {
        const name = safeName(decodeURIComponent(extended[1].trim()));
        if (name) return name;
      } catch {
        // A malformed encoded name can still have a usable plain filename.
      }
    }
    const plain = /(?:^|;)\s*filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]*))/i.exec(disposition);
    const name = safeName((plain?.[1] ?? plain?.[2] ?? '').replace(/\\(["\\])/g, '$1'));
    if (name) return name;
  }
  return safeName(fallback) || 'result';
}
