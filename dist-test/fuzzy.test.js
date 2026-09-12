// tests/fuzzy.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/renderer/core/fold.ts
var EXTRA_FOLDS = [
  [/[ß]/g, "ss"],
  [/[æ]/g, "ae"],
  [/[œ]/g, "oe"],
  [/[ø]/g, "o"],
  [/[đđ]/g, "d"],
  [/[łł]/g, "l"],
  [/[þ]/g, "th"],
  [/[ð]/g, "d"]
];
function fold(text) {
  let out = text.toLowerCase();
  for (const [pattern, replacement] of EXTRA_FOLDS) {
    out = out.replace(pattern, replacement);
  }
  return out.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// src/renderer/core/fuzzy.ts
var NAME_EXACT = 1e3;
var NAME_PREFIX = 900;
var NAME_WORD_COVER = 820;
var NAME_SUBSTRING = 700;
function fuzzyScore(rawQuery, rawTarget) {
  const query = fold(rawQuery.trim());
  if (query === "") return 0;
  const target = fold(rawTarget);
  const tokens = query.split(/\s+/);
  const words = target.split(/[^a-z0-9]+/).filter((w) => w !== "");
  let total = 0;
  for (const token of tokens) {
    const s = tokenScore(token, target, words);
    if (s === null) return null;
    total += s;
  }
  return total / Math.sqrt(tokens.length);
}
function nameMatchScore(rawQuery, rawName) {
  const query = fold(rawQuery.trim());
  if (query === "") return null;
  const name = fold(rawName);
  if (query === name) return NAME_EXACT;
  if (name.startsWith(query)) return NAME_PREFIX;
  const tokens = query.split(/\s+/).filter((t) => t !== "");
  const words = name.split(/[^a-z0-9]+/).filter((w) => w !== "");
  if (tokens.length > 0 && tokens.every((t) => words.some((w) => w.startsWith(t)))) {
    return NAME_WORD_COVER;
  }
  if (name.includes(query)) return NAME_SUBSTRING;
  return fuzzyScore(rawQuery, rawName);
}
function tokenScore(token, whole, words) {
  if (token === "") return 0;
  if (whole.includes(token)) {
    return 55 + Math.min(token.length, 12);
  }
  let best = null;
  for (const word of words) {
    const s = subsequenceInWord(token, word);
    if (s !== null && (best === null || s > best)) best = s;
  }
  if (best !== null) return best;
  return typoScore(token, words);
}
function typoScore(token, words) {
  if (token.length <= 2) return null;
  const budget = token.length <= 4 ? 1 : 2;
  let best = null;
  for (const word of words) {
    const d = editDistance(token, word, budget);
    if (d !== null && (best === null || d < best)) best = d;
  }
  if (best === null) return null;
  return Math.max(0.5, 10 - 4 * best);
}
function editDistance(a, b, max) {
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > max) return null;
  let prev2 = new Array(bl + 1).fill(Number.POSITIVE_INFINITY);
  let prev = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    const cur = new Array(bl + 1);
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
function subsequenceInWord(token, word) {
  if (token.length > word.length) return null;
  let wi = 0;
  let prev = -2;
  let score = 1;
  for (let qi = 0; qi < token.length; qi++) {
    const qc = token[qi];
    let j = wi;
    while (j < word.length && word[j] !== qc) j++;
    if (j >= word.length) {
      const swapped = qi + 1 < token.length && wi < word.length - 1 && word[wi] === token[qi + 1] && word[wi + 1] === qc;
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

// tests/fuzzy.test.ts
test("name exact match scores the top tier", () => {
  assert.equal(nameMatchScore("Mili", "Mili"), NAME_EXACT);
});
test("name match is case and accent blind", () => {
  assert.equal(nameMatchScore("MILI", "Mili"), NAME_EXACT);
  assert.equal(nameMatchScore("cafe", "Caf\xE9"), NAME_EXACT);
});
test("name prefix outranks substring", () => {
  assert.equal(nameMatchScore("mil", "Mili"), NAME_PREFIX);
  assert.equal(nameMatchScore("ili", "Mili"), NAME_SUBSTRING);
  assert.ok(NAME_PREFIX > NAME_SUBSTRING);
});
test("word coverage across a multi-word name", () => {
  assert.equal(nameMatchScore("looping rooms", "Looping the Rooms"), NAME_WORD_COVER);
  assert.equal(nameMatchScore("roo", "Looping the Rooms"), NAME_WORD_COVER);
});
test("ladder is strictly ordered", () => {
  assert.ok(NAME_EXACT > NAME_PREFIX);
  assert.ok(NAME_PREFIX > NAME_WORD_COVER);
  assert.ok(NAME_WORD_COVER > NAME_SUBSTRING);
});
test("dropped letters still match (subsequence)", () => {
  const s = fuzzyScore("aple", "apple");
  assert.ok(s !== null && s > 0);
});
test("substituted letters now match (typo rung)", () => {
  const s = fuzzyScore("appke", "apple");
  assert.ok(s !== null && s > 0);
});
test("swapped letters match as one edit", () => {
  const s = fuzzyScore("mlii", "mili");
  assert.ok(s !== null && s > 0);
});
test("typo inside a longer word matches", () => {
  const s = fuzzyScore("kalafena", "Kalafina");
  assert.ok(s !== null && s > 0);
});
test("two-letter tokens get no typo leniency", () => {
  assert.equal(fuzzyScore("xy", "ab"), null);
});
test("short words allow only one edit", () => {
  assert.equal(fuzzyScore("abcd", "abxy"), null);
  const one = fuzzyScore("abcx", "abcy");
  assert.ok(one !== null && one > 0);
});
test("longer words allow two edits", () => {
  const s = fuzzyScore("millenium", "millennium");
  assert.ok(s !== null && s > 0);
});
test("one impossible token kills the whole query", () => {
  assert.equal(fuzzyScore("mili zzzqq", "mili"), null);
});
test("a typo match never outranks a plain substring match", () => {
  const typo = nameMatchScore("appke", "Apple");
  assert.ok(typo !== null && typo < NAME_SUBSTRING);
});
test("a real match outranks the same text with a typo", () => {
  const clean = fuzzyScore("apple", "apple pie");
  const sloppy = fuzzyScore("appke", "apple pie");
  assert.ok(clean !== null && sloppy !== null && clean > sloppy);
});
test("empty query scores zero on hay and null on name", () => {
  assert.equal(fuzzyScore("   ", "mili"), 0);
  assert.equal(nameMatchScore("   ", "Mili"), null);
});
test("multi-token query with every token matched outscores a single token", () => {
  const single = fuzzyScore("mili", "mili");
  const multi = fuzzyScore("mili mili", "mili mili");
  assert.ok(single !== null && multi !== null);
  assert.ok(multi > single);
});
