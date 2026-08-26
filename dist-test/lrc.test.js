// tests/lrc.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/renderer/core/lrc.ts
var TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
var META_TAG = /^\[([a-zA-Z+#]{1,12}):([^\]]*)\]$/;
function fractionToMs(raw) {
  if (raw === void 0) return 0;
  const padded = raw.padEnd(3, "0");
  return parseInt(padded, 10);
}
function parseLrc(raw) {
  const metadata = {};
  const collected = [];
  const text = raw.replace(/^\uFEFF/, "");
  for (const rawLine of text.split(/\r\n|\n|\r/)) {
    const line = rawLine.trim();
    if (line === "") continue;
    TIME_TAG.lastIndex = 0;
    const stamps = [];
    let lastEnd = 0;
    let match;
    while ((match = TIME_TAG.exec(line)) !== null) {
      if (match.index !== lastEnd) break;
      const minutes = parseInt(match[1] ?? "0", 10);
      const seconds = parseInt(match[2] ?? "0", 10);
      stamps.push(minutes * 6e4 + seconds * 1e3 + fractionToMs(match[3]));
      lastEnd = TIME_TAG.lastIndex;
    }
    if (stamps.length === 0) {
      const metaMatch = META_TAG.exec(line);
      if (metaMatch !== null) {
        const key = (metaMatch[1] ?? "").toLowerCase();
        if (key !== "") metadata[key] = (metaMatch[2] ?? "").trim();
      }
      continue;
    }
    const content = line.slice(lastEnd).trim();
    if (content === "") continue;
    for (const stamp of stamps) {
      collected.push({ timeMs: Math.max(0, stamp), text: content });
    }
  }
  let shift = 0;
  const offsetRaw = metadata["offset"];
  if (offsetRaw !== void 0 && offsetRaw !== "") {
    const value = parseInt(offsetRaw, 10);
    if (Number.isFinite(value)) shift = -value;
  }
  if (shift !== 0) {
    for (const lineItem of collected) {
      lineItem.timeMs = Math.max(0, lineItem.timeMs + shift);
    }
  }
  collected.sort((a, b) => a.timeMs - b.timeMs);
  return { synced: collected.length > 0, lines: collected, metadata };
}
function activeLineIndex(lines, timeMs) {
  let lo = 0;
  let hi = lines.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = lo + hi >> 1;
    const lineItem = lines[mid];
    if (lineItem === void 0) break;
    if (lineItem.timeMs <= timeMs) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

// tests/lrc.test.ts
test("simple timestamp with hundredths", () => {
  const r = parseLrc("[00:12.34]Hello stars");
  assert.equal(r.synced, true);
  assert.deepEqual(r.lines, [{ timeMs: 12340, text: "Hello stars" }]);
});
test("timestamp without fraction", () => {
  const r = parseLrc("[12:34]Deep space");
  assert.deepEqual(r.lines[0]?.timeMs, 754e3);
});
test("millisecond precision", () => {
  const r = parseLrc("[01:02.003]Precise");
  assert.deepEqual(r.lines[0]?.timeMs, 62003);
});
test("single digit fraction means tenths", () => {
  const r = parseLrc("[00:07.5]Half");
  assert.deepEqual(r.lines[0]?.timeMs, 7500);
});
test("minutes beyond 59 for long mixes", () => {
  const r = parseLrc("[75:30]Long haul");
  assert.deepEqual(r.lines[0]?.timeMs, 453e4);
});
test("multiple timestamps on one line expand", () => {
  const r = parseLrc("[00:05][00:10.250]Refrain");
  assert.deepEqual(
    r.lines.map((l) => l.timeMs),
    [5e3, 10250]
  );
  assert.ok(r.lines.every((l) => l.text === "Refrain"));
});
test("metadata tags captured and lowercased", () => {
  const r = parseLrc("[ar:Mili]\n[ti:Cassette]\n[al:Hue]\n[00:01]Go");
  assert.equal(r.metadata["ar"], "Mili");
  assert.equal(r.metadata["ti"], "Cassette");
  assert.equal(r.metadata["al"], "Hue");
  assert.deepEqual(r.lines.length, 1);
});
test("positive offset shifts lyrics earlier", () => {
  const r = parseLrc("[offset:+2000]\n[00:10]Sooner");
  assert.deepEqual(r.lines[0]?.timeMs, 8e3);
});
test("negative offset shifts lyrics later", () => {
  const r = parseLrc("[offset:-1500]\n[00:10]Later");
  assert.deepEqual(r.lines[0]?.timeMs, 11500);
});
test("clamped at zero after aggressive offset", () => {
  const r = parseLrc("[offset:+5000]\n[00:01]Clamped");
  assert.deepEqual(r.lines[0]?.timeMs, 0);
});
test("BOM and CRLF tolerated", () => {
  const r = parseLrc("\uFEFF[00:03.2]One\r\n[00:04.3]Two\r\n");
  assert.deepEqual(
    r.lines.map((l) => l.text),
    ["One", "Two"]
  );
  assert.deepEqual(r.lines[1]?.timeMs, 4300);
});
test("unsorted input comes out sorted", () => {
  const r = parseLrc("[00:30]Late\n[00:02]Early\n[00:15]Middle");
  assert.deepEqual(
    r.lines.map((l) => l.text),
    ["Early", "Middle", "Late"]
  );
});
test("malformed bracket line is ignored safely", () => {
  const r = parseLrc("[hello world] oops\n[00:01]Fine");
  assert.deepEqual(r.lines.length, 1);
  assert.deepEqual(r.lines[0]?.text, "Fine");
});
test("metadata-like junk with digits is not treated as metadata", () => {
  const r = parseLrc("[99x:1] junk\n[00:01]Fine");
  assert.deepEqual(Object.keys(r.metadata).length, 0);
  assert.deepEqual(r.lines.length, 1);
});
test("empty lyric lines are dropped", () => {
  const r = parseLrc("[00:01]\n[00:02]Real\n[00:03]   ");
  assert.deepEqual(r.lines.length, 1);
  assert.deepEqual(r.lines[0]?.text, "Real");
});
test("brackets inside lyric text survive", () => {
  const r = parseLrc("[00:09]Word [chorus] end");
  assert.deepEqual(r.lines[0]?.text, "Word [chorus] end");
});
test("colon fraction variant accepted", () => {
  const r = parseLrc("[00:08:25]Colon frac");
  assert.deepEqual(r.lines[0]?.timeMs, 8250);
});
test("invalid offset metadata is ignored", () => {
  const r = parseLrc("[offset:banana]\n[00:10]Untouched");
  assert.deepEqual(r.lines[0]?.timeMs, 1e4);
});
test("empty document reports unsynced", () => {
  const r = parseLrc("");
  assert.equal(r.synced, false);
  assert.deepEqual(r.lines.length, 0);
});
test("activeLineIndex boundaries", () => {
  const { lines } = parseLrc("[00:10]A\n[00:20]B\n[00:30]C");
  assert.equal(activeLineIndex(lines, 0), -1);
  assert.equal(activeLineIndex(lines, 9999), -1);
  assert.equal(activeLineIndex(lines, 1e4), 0);
  assert.equal(activeLineIndex(lines, 19999), 0);
  assert.equal(activeLineIndex(lines, 2e4), 1);
  assert.equal(activeLineIndex(lines, 999999), 2);
});
