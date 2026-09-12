import { fold } from './fold';

export const NAME_EXACT = 1000;
export const NAME_PREFIX = 900;
export const NAME_WORD_COVER = 820;
export const NAME_SUBSTRING = 700;

export function fuzzyScore(rawQuery: string, rawTarget: string): number | null {
  const query = fold(rawQuery.trim());
  if (query === '') return 0;
  const target = fold(rawTarget);

  const tokens = query.split(/\s+/);
  const words = target.split(/[^a-z0-9]+/).filter((w) => w !== '');

  let total = 0;
  for (const token of tokens) {
    const s = tokenScore(token, target, words);
    if (s === null) return null;
    total += s;
  }
  return total / Math.sqrt(tokens.length);
}

export function nameMatchScore(rawQuery: string, rawName: string): number | null {
  const query = fold(rawQuery.trim());
  if (query === '') return null;
  const name = fold(rawName);
  if (query === name) return NAME_EXACT;
  if (name.startsWith(query)) return NAME_PREFIX;
  const tokens = query.split(/\s+/).filter((t) => t !== '');
  const words = name.split(/[^a-z0-9]+/).filter((w) => w !== '');
  if (tokens.length > 0 && tokens.every((t) => words.some((w) => w.startsWith(t)))) {
    return NAME_WORD_COVER;
  }
  if (name.includes(query)) return NAME_SUBSTRING;
  return fuzzyScore(rawQuery, rawName);
}

function tokenScore(token: string, whole: string, words: readonly string[]): number | null {
  if (token === '') return 0;

  if (whole.includes(token)) {
    return 55 + Math.min(token.length, 12);
  }

  let best: number | null = null;
  for (const word of words) {
    const s = subsequenceInWord(token, word);
    if (s !== null && (best === null || s > best)) best = s;
  }
  if (best !== null) return best;

  return typoScore(token, words);
}

function typoScore(token: string, words: readonly string[]): number | null {
  if (token.length <= 2) return null;
  const budget = token.length <= 4 ? 1 : 2;
  let best: number | null = null;
  for (const word of words) {
    const d = editDistance(token, word, budget);
    if (d !== null && (best === null || d < best)) best = d;
  }
  if (best === null) return null;
  return Math.max(0.5, 10 - 4 * best);
}

function editDistance(a: string, b: string, max: number): number | null {
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > max) return null;

  let prev2: number[] = new Array<number>(bl + 1).fill(Number.POSITIVE_INFINITY);
  let prev = new Array<number>(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;

  for (let i = 1; i <= al; i++) {
    const cur = new Array<number>(bl + 1);
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const above = prev[j] ?? Number.POSITIVE_INFINITY;
      const left = cur[j - 1] ?? Number.POSITIVE_INFINITY;
      const diag = prev[j - 1] ?? Number.POSITIVE_INFINITY;
      let v = Math.min(above + 1, left + 1, diag + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, (prev2[j - 2] ?? Number.POSITIVE_INFINITY) + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return null;
    prev2 = prev;
    prev = cur;
  }
  return prev[bl] ?? null;
}

function subsequenceInWord(token: string, word: string): number | null {
  if (token.length > word.length) return null;

  let wi = 0;
  let prev = -2;
  let score = 1;

  for (let qi = 0; qi < token.length; qi++) {
    const qc = token[qi];
    let j = wi;
    while (j < word.length && word[j] !== qc) j++;

    if (j >= word.length) {
      const swapped =
        qi + 1 < token.length &&
        wi < word.length - 1 &&
        word[wi] === token[qi + 1] &&
        word[wi + 1] === qc;
      if (!swapped) return null;
      score += 2;
      prev = wi + 1;
      wi = wi + 2;
      qi++;
      continue;
    }

    if (prev >= 0 && j > prev + 1) {
      score -= Math.min((j - prev - 1) * 0.5, 3);
    }
    if (j === 0) score += 9;
    if (j === prev + 1) score += 5;

    score += 1;
    prev = j;
    wi = j + 1;
  }

  return Math.max(score, 0.5);
}
