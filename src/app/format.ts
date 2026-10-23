export function formatBytes(bytes: number, lang: string): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) {
    return new Intl.NumberFormat(lang, {
      style: 'unit',
      unit: 'megabyte',
      maximumFractionDigits: 1,
    }).format(mb);
  }
  return new Intl.NumberFormat(lang, {
    style: 'unit',
    unit: 'kilobyte',
    maximumFractionDigits: 0,
  }).format(Math.max(1, bytes / 1024));
}
