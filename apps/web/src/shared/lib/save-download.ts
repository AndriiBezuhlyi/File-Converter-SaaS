export function saveDownload(blob: Blob, name: string) {
  if (blob.size === 0) throw new Error('Empty download.');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download =
    name
      .split(/[\\/]/)
      .at(-1)
      ?.replace(/\p{Cc}/gu, '') || 'result';
  try {
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}
