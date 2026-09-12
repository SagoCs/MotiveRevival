import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fuzzyScore,
  nameMatchScore,
  NAME_EXACT,
  NAME_PREFIX,
  NAME_WORD_COVER,
  NAME_SUBSTRING,
} from '../src/renderer/core/fuzzy';

test('name exact match scores the top tier', () => {
  assert.equal(nameMatchScore('Mili', 'Mili'), NAME_EXACT);
});

test('name match is case and accent blind', () => {
  assert.equal(nameMatchScore('MILI', 'Mili'), NAME_EXACT);
  assert.equal(nameMatchScore('cafe', 'Café'), NAME_EXACT);
});

test('name prefix outranks substring', () => {
  assert.equal(nameMatchScore('mil', 'Mili'), NAME_PREFIX);
  assert.equal(nameMatchScore('ili', 'Mili'), NAME_SUBSTRING);
  assert.ok(NAME_PREFIX > NAME_SUBSTRING);
});

test('word coverage across a multi-word name', () => {
  assert.equal(nameMatchScore('looping rooms', 'Looping the Rooms'), NAME_WORD_COVER);
  assert.equal(nameMatchScore('roo', 'Looping the Rooms'), NAME_WORD_COVER);
});

test('ladder is strictly ordered', () => {
  assert.ok(NAME_EXACT > NAME_PREFIX);
  assert.ok(NAME_PREFIX > NAME_WORD_COVER);
  assert.ok(NAME_WORD_COVER > NAME_SUBSTRING);
});

test('dropped letters still match (subsequence)', () => {
  const s = fuzzyScore('aple', 'apple');
  assert.ok(s !== null && s > 0);
});

test('substituted letters now match (typo rung)', () => {
  const s = fuzzyScore('appke', 'apple');
  assert.ok(s !== null && s > 0);
});

test('swapped letters match as one edit', () => {
  const s = fuzzyScore('mlii', 'mili');
  assert.ok(s !== null && s > 0);
});

test('typo inside a longer word matches', () => {
  const s = fuzzyScore('kalafena', 'Kalafina');
  assert.ok(s !== null && s > 0);
});

test('two-letter tokens get no typo leniency', () => {
  assert.equal(fuzzyScore('xy', 'ab'), null);
});

test('short words allow only one edit', () => {
  assert.equal(fuzzyScore('abcd', 'abxy'), null);
  const one = fuzzyScore('abcx', 'abcy');
  assert.ok(one !== null && one > 0);
});

test('longer words allow two edits', () => {
  const s = fuzzyScore('millenium', 'millennium');
  assert.ok(s !== null && s > 0);
});

test('one impossible token kills the whole query', () => {
  assert.equal(fuzzyScore('mili zzzqq', 'mili'), null);
});

test('a typo match never outranks a plain substring match', () => {
  const typo = nameMatchScore('appke', 'Apple');
  assert.ok(typo !== null && typo < NAME_SUBSTRING);
});

test('a real match outranks the same text with a typo', () => {
  const clean = fuzzyScore('apple', 'apple pie');
  const sloppy = fuzzyScore('appke', 'apple pie');
  assert.ok(clean !== null && sloppy !== null && clean > sloppy);
});

test('empty query scores zero on hay and null on name', () => {
  assert.equal(fuzzyScore('   ', 'mili'), 0);
  assert.equal(nameMatchScore('   ', 'Mili'), null);
});

test('multi-token query with every token matched outscores a single token', () => {
  const single = fuzzyScore('mili', 'mili');
  const multi = fuzzyScore('mili mili', 'mili mili');
  assert.ok(single !== null && multi !== null);
  assert.ok(multi > single);
});
