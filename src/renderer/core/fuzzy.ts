import { fold } from './fold';

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
  return best;
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
