export function basenameOf(pathOrName: string): string {
  const cleaned = pathOrName.replace(/\/+$/, '');
  const idx = cleaned.lastIndexOf('.');
  if (idx > 0) return cleaned.slice(0, idx);
  return cleaned;
}
