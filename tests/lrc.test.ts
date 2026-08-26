import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLrc, activeLineIndex } from '../src/renderer/core/lrc';

test('simple timestamp with hundredths', () => {
  const r = parseLrc('[00:12.34]Hello stars');
  assert.equal(r.synced, true);
  assert.deepEqual(r.lines, [{ timeMs: 12340, text: 'Hello stars' }]);
});

test('timestamp without fraction', () => {
  const r = parseLrc('[12:34]Deep space');
  assert.deepEqual(r.lines[0]?.timeMs, 754000);
});

test('millisecond precision', () => {
  const r = parseLrc('[01:02.003]Precise');
  assert.deepEqual(r.lines[0]?.timeMs, 62003);
});

test('single digit fraction means tenths', () => {
  const r = parseLrc('[00:07.5]Half');
  assert.deepEqual(r.lines[0]?.timeMs, 7500);
});

test('minutes beyond 59 for long mixes', () => {
  const r = parseLrc('[75:30]Long haul');
  assert.deepEqual(r.lines[0]?.timeMs, 4530000);
});

test('multiple timestamps on one line expand', () => {
  const r = parseLrc('[00:05][00:10.250]Refrain');
  assert.deepEqual(
    r.lines.map((l) => l.timeMs),
    [5000, 10250],
  );
  assert.ok(r.lines.every((l) => l.text === 'Refrain'));
});

test('metadata tags captured and lowercased', () => {
  const r = parseLrc('[ar:Mili]\n[ti:Cassette]\n[al:Hue]\n[00:01]Go');
  assert.equal(r.metadata['ar'], 'Mili');
  assert.equal(r.metadata['ti'], 'Cassette');
  assert.equal(r.metadata['al'], 'Hue');
  assert.deepEqual(r.lines.length, 1);
});

test('positive offset shifts lyrics earlier', () => {
  const r = parseLrc('[offset:+2000]\n[00:10]Sooner');
  assert.deepEqual(r.lines[0]?.timeMs, 8000);
});

test('negative offset shifts lyrics later', () => {
  const r = parseLrc('[offset:-1500]\n[00:10]Later');
  assert.deepEqual(r.lines[0]?.timeMs, 11500);
});

test('clamped at zero after aggressive offset', () => {
  const r = parseLrc('[offset:+5000]\n[00:01]Clamped');
  assert.deepEqual(r.lines[0]?.timeMs, 0);
});

test('BOM and CRLF tolerated', () => {
  const r = parseLrc('\uFEFF[00:03.2]One\r\n[00:04.3]Two\r\n');
  assert.deepEqual(
    r.lines.map((l) => l.text),
    ['One', 'Two'],
  );
  assert.deepEqual(r.lines[1]?.timeMs, 4300);
});

test('unsorted input comes out sorted', () => {
  const r = parseLrc('[00:30]Late\n[00:02]Early\n[00:15]Middle');
  assert.deepEqual(
    r.lines.map((l) => l.text),
    ['Early', 'Middle', 'Late'],
  );
});

test('malformed bracket line is ignored safely', () => {
  const r = parseLrc('[hello world] oops\n[00:01]Fine');
  assert.deepEqual(r.lines.length, 1);
  assert.deepEqual(r.lines[0]?.text, 'Fine');
});

test('metadata-like junk with digits is not treated as metadata', () => {
  const r = parseLrc('[99x:1] junk\n[00:01]Fine');
  assert.deepEqual(Object.keys(r.metadata).length, 0);
  assert.deepEqual(r.lines.length, 1);
});

test('empty lyric lines are dropped', () => {
  const r = parseLrc('[00:01]\n[00:02]Real\n[00:03]   ');
  assert.deepEqual(r.lines.length, 1);
  assert.deepEqual(r.lines[0]?.text, 'Real');
});

test('brackets inside lyric text survive', () => {
  const r = parseLrc('[00:09]Word [chorus] end');
  assert.deepEqual(r.lines[0]?.text, 'Word [chorus] end');
});

test('colon fraction variant accepted', () => {
  const r = parseLrc('[00:08:25]Colon frac');
  assert.deepEqual(r.lines[0]?.timeMs, 8250);
});

test('invalid offset metadata is ignored', () => {
  const r = parseLrc('[offset:banana]\n[00:10]Untouched');
  assert.deepEqual(r.lines[0]?.timeMs, 10000);
});

test('empty document reports unsynced', () => {
  const r = parseLrc('');
  assert.equal(r.synced, false);
  assert.deepEqual(r.lines.length, 0);
});

test('activeLineIndex boundaries', () => {
  const { lines } = parseLrc('[00:10]A\n[00:20]B\n[00:30]C');
  assert.equal(activeLineIndex(lines, 0), -1);
  assert.equal(activeLineIndex(lines, 9999), -1);
  assert.equal(activeLineIndex(lines, 10000), 0);
  assert.equal(activeLineIndex(lines, 19999), 0);
  assert.equal(activeLineIndex(lines, 20000), 1);
  assert.equal(activeLineIndex(lines, 999999), 2);
});
