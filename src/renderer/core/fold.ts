const EXTRA_FOLDS: Array<[RegExp, string]> = [
  [/[ß]/g, 'ss'],
  [/[æ]/g, 'ae'],
  [/[œ]/g, 'oe'],
  [/[ø]/g, 'o'],
  [/[đđ]/g, 'd'],
  [/[łł]/g, 'l'],
  [/[þ]/g, 'th'],
  [/[ð]/g, 'd'],
];

export function fold(text: string): string {
  let out = text.toLowerCase();
  for (const [pattern, replacement] of EXTRA_FOLDS) {
    out = out.replace(pattern, replacement);
  }
  return out.normalize('NFD').replace(/[̀-ͯ]/g, '');
}
