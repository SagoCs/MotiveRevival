import net from 'node:net';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const port = process.env.QUEUE_PORT ?? '9222';
setTimeout(() => { console.error('probe watchdog: 150s without finishing'); process.exit(2); }, 150000).unref();

let page = null;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 700));
  try {
    const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
    page = targets.find((t) => t.type === 'page');
    if (page) break;
  } catch {}
}
if (!page) throw new Error(`no page target on port ${port} - launch the app with --remote-debugging-port=${port} first`);

const url = new URL(page.webSocketDebuggerUrl.replace('ws://', 'http://'));
const key = crypto.randomBytes(16).toString('base64');
const socket = net.connect(Number(url.port), '127.0.0.1');
await new Promise((res, rej) => { socket.once('connect', res); socket.once('error', rej); });
let handshakeResolve = null;
const handshake = new Promise((res) => { handshakeResolve = res; });
socket.write(
  `GET ${url.pathname} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
);
let buf = Buffer.alloc(0);
let upgraded = false;
const pending = new Map();
let nextId = 1;
socket.on('close', () => {
  for (const p of pending.values()) p.rej(new Error('cdp socket closed'));
  pending.clear();
});
socket.on('data', (c) => {
  buf = Buffer.concat([buf, c]);
  if (!upgraded) {
    const i = buf.indexOf('\r\n\r\n');
    if (i === -1) return;
    const head = buf.subarray(0, i).toString();
    if (!head.includes(' 101 ')) { console.error('handshake refused'); process.exit(2); }
    buf = buf.subarray(i + 4);
    upgraded = true;
    handshakeResolve();
  }
  while (true) {
    if (buf.length < 2) return;
    const opcode = buf[0] & 15;
    let len = buf[1] & 0x7f;
    let off = 2;
    if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
    if (buf.length < off + len) return;
    const payload = buf.subarray(off, off + len);
    buf = buf.subarray(off + len);
    if (opcode === 1) {
      const msg = JSON.parse(payload.toString('utf8'));
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(JSON.stringify(msg.error)));
        else res(msg.result);
      }
    }
  }
});
await handshake;
function send(method, params = {}) {
  const id = nextId++;
  const data = Buffer.from(JSON.stringify({ id, method, params }), 'utf8');
  const mask = crypto.randomBytes(4);
  let header;
  if (data.length < 126) { header = Buffer.alloc(2); header[0] = 0x81; header[1] = 0x80 | data.length; }
  else { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(data.length, 2); }
  const masked = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
  socket.write(Buffer.concat([header, mask, masked]));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result?.value;
}
function decode(png) {
  let pos = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (pos < png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.toString('ascii', pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 3;
  const px = Buffer.alloc(height * stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    for (let i = 0; i < stride; i++) {
      const left = i >= 3 ? px[y * stride + i - 3] : 0;
      const up = y > 0 ? px[(y - 1) * stride + i] : 0;
      const ul = y > 0 && i >= 3 ? px[(y - 1) * stride + i - 3] : 0;
      const cur = raw[rp + i];
      let val;
      if (filter === 0) val = cur;
      else if (filter === 1) val = cur + left;
      else if (filter === 2) val = cur + up;
      else if (filter === 3) val = cur + ((left + up) >> 1);
      else {
        const a = left; const b = up; const c = ul;
        const pa = Math.abs(b - c); const pb = Math.abs(a - c); const pc = Math.abs(a + b - 2 * c);
        val = cur + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      px[y * stride + i] = val & 0xff;
    }
    rp += stride;
  }
  return { width, height, px, stride };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const realClick = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
};
const realEsc = async () => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
};
const parkPointer = async () => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
  await sleep(120);
};

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
  if (!ok) failed++;
};

await send('Page.enable');
await send('Page.reload');
await sleep(2800);

for (let i = 0; i < 20; i++) {
  const ready = await evalJs(`window.__songActions !== undefined && window.__songActions.libraryTracks().length > 0 && window.__queueRiver !== undefined`);
  if (ready) break;
  await sleep(850);
}
const ready = await evalJs(`window.__songActions !== undefined && window.__songActions.libraryTracks().length > 0 && window.__queueRiver !== undefined`);
if (!ready) {
  console.log('library or probe handle not ready');
  process.exit(1);
}

const picks = await evalJs(`(() => {
  const lib = window.__songActions.libraryTracks();
  const out = [];
  const albums = new Set();
  for (const t of lib) {
    const a = t.album ?? '';
    if (albums.has(a)) continue;
    albums.add(a);
    out.push({ id: t.id, title: t.title, artist: t.artist ?? '' });
    if (out.length === 6) break;
  }
  return out;
})()`);
if (picks.length < 6) {
  console.log('could not pick 6 distinct-album tracks');
  process.exit(1);
}
console.log(`picks: ${JSON.stringify(picks.map((p) => p.title))}`);

for (let i = 0; i < 10; i++) {
  const a = await evalJs(`JSON.stringify(window.__songActions.queueSnapshot())`);
  await sleep(450);
  const b = await evalJs(`JSON.stringify(window.__songActions.queueSnapshot())`);
  if (a === b) break;
}

const seeded = await evalJs(`(() => {
  const A = window.__songActions;
  const lib = A.libraryTracks();
  const ids = ${JSON.stringify(picks.slice(0, 5).map((p) => p.id))};
  const tracks = ids.map((id) => lib.find((t) => t.id === id));
  if (tracks.some((t) => t === undefined)) return false;
  A.setContext(tracks, 0);
  return true;
})()`);
await sleep(600);
check('clean queue seeded (five songs, first playing)', seeded === true);
const s0 = await evalJs(`window.__songActions.queueSnapshot()`);
check('seed snapshot: t0 current, four upcoming', s0.index === 0 && JSON.stringify(s0.upcoming) === JSON.stringify(picks.slice(1, 5).map((p) => p.id)), JSON.stringify({ index: s0.index, upcoming: s0.upcoming.length }));

await evalJs(`window.__songActions.libraryTracks() && document.querySelector('[data-mode="albums"]').click()`);
await sleep(850);

const qBtn = await evalJs(`(() => { const b = document.querySelector('.queue-toggle'); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
await realClick(qBtn.x, qBtn.y);
await sleep(900);

const opened = await evalJs(`(() => {
  const root = document.getElementById('queue-river');
  const floor = document.getElementById('queue-river-floor');
  return {
    open: window.__queueRiver.isOpen(),
    rootOn: root?.classList.contains('on') ?? false,
    rootZ: root ? getComputedStyle(root).zIndex : '',
    floorOn: floor?.classList.contains('on') ?? false,
    floorZ: floor ? getComputedStyle(floor).zIndex : '',
    lit: document.querySelector('.queue-toggle').classList.contains('lit'),
  };
})()`);
check('button opens the queue river world', opened.open === true && opened.rootOn === true && opened.floorOn === true, JSON.stringify(opened));
check('button lights while it owns the world', opened.lit === true);
check('world stacks above other worlds, below chrome', Number(opened.floorZ) === 27 && Number(opened.rootZ) === 28, `floor ${opened.floorZ}, root ${opened.rootZ}`);

const comp = await evalJs(`(() => {
  const Q = window.__queueRiver;
  const cards = [...document.querySelectorAll('#queue-river .rv2-card')].map((el) => {
    const r = el.getBoundingClientRect();
    return { id: el.dataset.id, i: Number(el.dataset.index), ghost: el.classList.contains('rv2-ghost'), y: r.top + r.height / 2, op: Number(getComputedStyle(el).opacity) };
  }).sort((a, b) => a.i - b.i);
  const region = { top: 52, bottom: window.innerHeight - 62 };
  return { ids: Q.ids(), ghosts: Q.ghostIds(), center: Q.centerId(), scroll: Q.scroll(), cards, committed: document.querySelector('#queue-river .rv2-card.committed')?.dataset.id ?? null, regionMid: (region.top + region.bottom) / 2, regionTop: region.top, regionBottom: region.bottom };
})()`);
check('the whole queue circles in order, playing included', JSON.stringify(comp.ids) === JSON.stringify(picks.slice(0, 5).map((p) => p.id)), JSON.stringify(comp.ids));
check('nothing played yet: no ghosts', comp.ghosts.length === 0, JSON.stringify(comp.ghosts));
check('the playing song sits centered wearing the bloom', comp.center === picks[0].id && comp.committed === picks[0].id, JSON.stringify({ center: comp.center, committed: comp.committed }));
const nowCard = comp.cards.find((c) => c.id === picks[0].id);
const others = comp.cards.filter((c) => c.id !== picks[0].id);
check('the now card is at the region middle', nowCard !== undefined && Math.abs(nowCard.y - comp.regionMid) < 80, nowCard ? `dy=${(nowCard.y - comp.regionMid).toFixed(1)}` : 'missing');
check('upcoming begin below the now card', nowCard !== undefined && comp.cards.length === 5 && others[0].y > nowCard.y + 40 && others.every((c) => c.y > comp.regionTop && c.y < comp.regionBottom), JSON.stringify({ ys: others.map((c) => Math.round(c.y)), mid: Math.round(comp.regionMid) }));

const capProbe = await evalJs(`(() => {
  const byId = (id) => [...document.querySelectorAll('#queue-river .rv2-card')].find((c) => c.dataset.id === id);
  const now = byId(${JSON.stringify(picks[0].id)});
  const up = byId(${JSON.stringify(picks[1].id)});
  const deep = byId(${JSON.stringify(picks[3].id)});
  const read = (el) => {
    const cap = el?.querySelector('.rv2-cap');
    return { text: cap?.textContent ?? null, accent: cap?.classList.contains('cap-accent') ?? false, restOpacity: cap ? getComputedStyle(cap).opacity : null };
  };
  const rect = (el) => {
    if (el === undefined || el === null) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  return { now: read(now), up: read(up), deep: read(deep), nowRect: rect(now) };
})()`);
check('whisper captions: Playing / Up next / N away at rest-invisible', capProbe.now.text === 'Playing' && capProbe.now.accent === true && capProbe.up.text === 'Up next' && capProbe.deep.text === '3 away' && Number(capProbe.now.restOpacity) === 0, JSON.stringify({ now: capProbe.now.text, up: capProbe.up.text, deep: capProbe.deep.text, rest: capProbe.now.restOpacity }));
if (capProbe.nowRect) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(capProbe.nowRect.x), y: Math.round(capProbe.nowRect.y) });
  await sleep(320);
  const hovered = await evalJs(`(() => {
    const cap = document.querySelector('#queue-river .rv2-card:hover .rv2-cap');
    return { opacity: cap ? getComputedStyle(cap).opacity : null };
  })()`);
  check('hovering the now card reveals its whisper', hovered.opacity !== null && Number(hovered.opacity) > 0.9, JSON.stringify(hovered));
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
  await sleep(260);
}

const coverSpot = await evalJs(`(() => {
  const beneath = [...document.querySelectorAll('.album-card')].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 60 && r.height > 60 && r.top > 52 && r.bottom < window.innerHeight - 62);
  const queueCards = [...document.querySelectorAll('#queue-river .rv2-card')].map((el) => el.getBoundingClientRect());
  const inside = (x, y) => queueCards.some((q) => x > q.left - 8 && x < q.right + 8 && y > q.top - 8 && y < q.bottom + 8);
  for (const r of beneath) {
    const cands = [
      [r.left + r.width / 2, r.top + r.height / 2],
      [r.left + r.width * 0.15, r.top + r.height * 0.2],
      [r.right - r.width * 0.15, r.top + r.height * 0.2],
      [r.left + r.width * 0.15, r.bottom - r.height * 0.2],
      [r.right - r.width * 0.15, r.bottom - r.height * 0.2],
    ];
    const spot = cands.find(([x, y]) => !inside(x, y));
    if (spot !== undefined) return { x: Math.round(spot[0]), y: Math.round(spot[1]) };
  }
  return null;
})()`);
console.log(`cover spot (album art beneath the world): ${JSON.stringify(coverSpot)}`);

if (coverSpot !== null) {
  await parkPointer();
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const img = decode(Buffer.from(shot.data, 'base64'));
  const yi = Math.min(img.height - 1, Math.max(0, coverSpot.y));
  let lumSum = 0;
  let n = 0;
  for (let dy = -6; dy <= 6; dy += 3) {
    for (let dx = -6; dx <= 6; dx += 3) {
      const xi = Math.min(img.width - 1, Math.max(0, coverSpot.x + dx));
      const yy = Math.min(img.height - 1, Math.max(0, yi + dy));
      const j = yy * img.stride + xi * 3;
      lumSum += 0.2126 * img.px[j] + 0.7152 * img.px[j + 1] + 0.0722 * img.px[j + 2];
      n++;
    }
  }
  const lum = n > 0 ? lumSum / n : 255;
  check('the world fades in on an empty background: album art beneath is covered by the void floor', lum < 30, `luminance ${lum.toFixed(1)} at ${JSON.stringify(coverSpot)}`);
} else {
  check('the world fades in on an empty background: album art beneath is covered by the void floor', false, 'no beneath-card spot found');
}

const nextBtn = await evalJs(`(() => { const b = [...document.querySelectorAll('.icon-btn.transport-skip')].find((x) => x.getAttribute('aria-label') === 'Next track'); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
await realClick(nextBtn.x, nextBtn.y);
await sleep(1500);

const afterAdvance = await evalJs(`(() => {
  const Q = window.__queueRiver;
  const cards = [...document.querySelectorAll('#queue-river .rv2-card')].map((el) => {
    const r = el.getBoundingClientRect();
    return { id: el.dataset.id, ghost: el.classList.contains('rv2-ghost'), y: r.top + r.height / 2, op: Number(getComputedStyle(el).opacity) };
  });
  return { ids: Q.ids(), ghosts: Q.ghostIds(), center: Q.centerId(), cards, open: Q.isOpen(), committed: document.querySelector('#queue-river .rv2-card.committed')?.dataset.id ?? null };
})()`);
check('world still open while playback advances', afterAdvance.open === true);
check('advance: the line keeps its shape while serving', JSON.stringify(afterAdvance.ids) === JSON.stringify(picks.slice(0, 5).map((p) => p.id)), JSON.stringify(afterAdvance.ids));
check('advance: ghosts are exactly the played songs', JSON.stringify(afterAdvance.ghosts) === JSON.stringify([picks[0].id]), JSON.stringify(afterAdvance.ghosts));
check('advance: the newly playing song glides to center wearing the bloom', afterAdvance.center === picks[1].id && afterAdvance.committed === picks[1].id, JSON.stringify({ center: afterAdvance.center, committed: afterAdvance.committed }));
const ghostCard = afterAdvance.cards.find((c) => c.id === picks[0].id);
check('served card rides dimmed above center', ghostCard !== undefined && ghostCard.op < 0.3 && ghostCard.y < afterAdvance.cards.find((c) => c.id === picks[1].id).y - 40, ghostCard ? JSON.stringify({ op: ghostCard.op.toFixed(2), y: Math.round(ghostCard.y) }) : 'missing');

const snapBeforeJump = await evalJs(`window.__songActions.queueSnapshot()`);
const jumpTargetRect = await evalJs(`(() => {
  const el = [...document.querySelectorAll('#queue-river .rv2-card')].find((c) => c.dataset.id === ${JSON.stringify(picks[4].id)});
  if (el === undefined) return null;
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`);
check('jump target card is on screen', jumpTargetRect !== null, JSON.stringify(jumpTargetRect));
if (jumpTargetRect !== null) {
  await realClick(jumpTargetRect.x, jumpTargetRect.y);
  await sleep(1500);
}
const afterJump = await evalJs(`(() => {
  const s = window.__songActions.queueSnapshot();
  const Q = window.__queueRiver;
  return { snapshot: s, ids: Q.ids(), ghosts: Q.ghostIds(), center: Q.centerId(), title: document.title, committed: document.querySelector('#queue-river .rv2-card.committed')?.dataset.id ?? null };
})()`);
check('jump-play: the clicked song is now playing', afterJump.title.includes(picks[4].title), afterJump.title);
check('jump-play: skipped songs deferred behind it in order', JSON.stringify(afterJump.snapshot.ids) === JSON.stringify([picks[0].id, picks[1].id, picks[4].id, picks[2].id, picks[3].id]) && afterJump.snapshot.index === 2, JSON.stringify(afterJump.snapshot));
check('jump-play: the clicked song rose to the now seat wearing the bloom', afterJump.center === picks[4].id && afterJump.committed === picks[4].id && afterJump.ids.includes(picks[4].id), JSON.stringify({ center: afterJump.center, committed: afterJump.committed }));
check('jump-play: the interrupted song moved into the played section', JSON.stringify(afterJump.ghosts) === JSON.stringify([picks[0].id, picks[1].id]), JSON.stringify(afterJump.ghosts));
check('jump-play: the world stayed open', afterJump.center === picks[4].id);
void snapBeforeJump;

await realEsc();
await sleep(950);
const closedByEsc = await evalJs(`(() => ({ open: window.__queueRiver.isOpen(), lit: document.querySelector('.queue-toggle').classList.contains('lit'), floorOn: document.getElementById('queue-river-floor').classList.contains('on') }))()`);
check('esc closes the world and unlights the button', closedByEsc.open === false && closedByEsc.lit === false && closedByEsc.floorOn === false, JSON.stringify(closedByEsc));

await evalJs(`document.getElementById('search-summon').click()`);
await sleep(400);
await evalJs(`(() => {
  const i = document.getElementById('oracle-input');
  i.focus();
  i.value = ${JSON.stringify(picks[5].title)};
  i.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(900);
const summonRow = await evalJs(`(() => {
  const row = document.querySelector('#oracle-results .oracle-row.kind-song');
  if (row === null) return null;
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  return true;
})()`);
await sleep(400);
const forkBtn = await evalJs(`(() => {
  const b = Array.from(document.querySelectorAll('.sm-fork-btn')).find((x) => x.textContent === 'Add to queue');
  if (b === undefined) return null;
  const r = b.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`);
check('summon row mounts the menu fork', summonRow === true && forkBtn !== null);
if (forkBtn !== null) {
  await realClick(forkBtn.x, forkBtn.y);
  await sleep(400);
}
const added = await evalJs(`(() => {
  const word = document.querySelector('.song-menu .sm-word')?.textContent ?? null;
  const s = window.__songActions.queueSnapshot();
  return { word, lastUpcoming: s.upcoming[s.upcoming.length - 1] ?? null, copies: s.ids.filter((x) => x === ${JSON.stringify(picks[5].id)}).length };
})()`);
check('add to queue answers Added', added.word === 'Added', String(added.word));
check('add to queue appends at the bottom of the line', added.lastUpcoming === picks[5].id, added.lastUpcoming ?? 'none');
check('never-twice: exactly one copy', added.copies === 1, String(added.copies));
await sleep(1100);

await evalJs(`(() => {
  const row = document.querySelector('#oracle-results .oracle-row.kind-song');
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
})()`);
await sleep(400);
const forkBtn2 = await evalJs(`(() => {
  const b = Array.from(document.querySelectorAll('.sm-fork-btn')).find((x) => x.textContent === 'Add to queue');
  if (b === undefined) return null;
  const r = b.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`);
if (forkBtn2 !== null) {
  await realClick(forkBtn2.x, forkBtn2.y);
  await sleep(400);
}
const again = await evalJs(`(() => {
  const word = document.querySelector('.song-menu .sm-word')?.textContent ?? null;
  const s = window.__songActions.queueSnapshot();
  return { word, copies: s.ids.filter((x) => x === ${JSON.stringify(picks[5].id)}).length };
})()`);
check('second add answers Already there and refuses to copy', again.word === 'Already there' && again.copies === 1, JSON.stringify(again));
await sleep(1100);
await realEsc();
await sleep(500);

await realClick(qBtn.x, qBtn.y);
await sleep(900);
const reopened = await evalJs(`window.__queueRiver.isOpen()`);
check('button reopens the world', reopened === true);
const withNew = await evalJs(`(() => {
  const Q = window.__queueRiver;
  const cards = [...document.querySelectorAll('#queue-river .rv2-card')].map((el) => {
    const r = el.getBoundingClientRect();
    return { id: el.dataset.id, ghost: el.classList.contains('rv2-ghost'), x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  return { ids: Q.ids(), ghosts: Q.ghostIds(), center: Q.centerId(), cards };
})()`);
check('freshly queued song joins the bottom of the river', withNew.ids[withNew.ids.length - 1] === picks[5].id && withNew.ghosts.includes(picks[5].id) === false, JSON.stringify({ ids: withNew.ids, ghosts: withNew.ghosts }));

const ghostSpot = withNew.cards.find((c) => c.id === picks[0].id);
check('played ghost present in view', ghostSpot !== undefined);
if (ghostSpot !== undefined) {
  const beforeGhostClick = await evalJs(`window.__songActions.queueSnapshot()`);
  await realClick(ghostSpot.x, ghostSpot.y);
  await sleep(850);
  const afterGhostClick = await evalJs(`(() => ({ s: window.__songActions.queueSnapshot(), title: document.title, open: window.__queueRiver.isOpen() }))()`);
  check('played cards are inert: clicking the past changes nothing', JSON.stringify(afterGhostClick.s.ids) === JSON.stringify(beforeGhostClick.ids) && afterGhostClick.title.includes(picks[4].title) === true && afterGhostClick.open === true, JSON.stringify({ title: afterGhostClick.title }));
}

const dragCard = await evalJs(`(() => {
  const el = [...document.querySelectorAll('#queue-river .rv2-card')].find((c) => c.dataset.id === ${JSON.stringify(picks[2].id)} && !c.classList.contains('rv2-ghost'));
  if (el === undefined) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`);
if (dragCard !== null) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(dragCard.x), y: Math.round(dragCard.y), button: 'left', clickCount: 1 });
  for (let s = 1; s <= 10; s++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(dragCard.x), y: Math.round(dragCard.y + s * 14), button: 'left' });
    await sleep(40);
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(dragCard.x), y: Math.round(dragCard.y + 140), button: 'left' });
  await sleep(1200);
}
const afterDrag = await evalJs(`(() => {
  const s = window.__songActions.queueSnapshot();
  return { upcoming: s.upcoming, ids: window.__queueRiver.ids(), ghosts: window.__queueRiver.ghostIds() };
})()`);
check('drag reorders the upcoming span and the river follows', JSON.stringify(afterDrag.upcoming) === JSON.stringify([picks[3].id, picks[2].id, picks[5].id]) && JSON.stringify(afterDrag.ids) === JSON.stringify([picks[0].id, picks[1].id, picks[4].id, picks[3].id, picks[2].id, picks[5].id]), JSON.stringify(afterDrag));
check('drag never touches the played section', JSON.stringify(afterDrag.ghosts) === JSON.stringify([picks[0].id, picks[1].id]), JSON.stringify(afterDrag.ghosts));

const drained = await evalJs(`(() => {
  const A = window.__songActions;
  const lib = A.libraryTracks();
  const a = lib.find((t) => t.id === ${JSON.stringify(picks[0].id)});
  const b = lib.find((t) => t.id === ${JSON.stringify(picks[1].id)});
  A.setContext([a, b], 1);
  return window.__songActions.queueSnapshot();
})()`);
await sleep(1600);
const drainedState = await evalJs(`(() => {
  const Q = window.__queueRiver;
  const cards = [...document.querySelectorAll('#queue-river .rv2-card')].map((el) => {
    const r = el.getBoundingClientRect();
    return { id: el.dataset.id, ghost: el.classList.contains('rv2-ghost'), y: r.top + r.height / 2 };
  });
  return { open: Q.isOpen(), ids: Q.ids(), ghosts: Q.ghostIds(), center: Q.centerId(), scroll: Q.scroll(), cards, regionMid: (52 + window.innerHeight - 62) / 2 };
})()`);
check('drained state: the resting song holds the center, history above', drainedState.open === true && JSON.stringify(drainedState.ids) === JSON.stringify([picks[0].id, picks[1].id]) && drainedState.center === picks[1].id && JSON.stringify(drainedState.ghosts) === JSON.stringify([picks[0].id]), JSON.stringify(drainedState));
check('drained state: the ghost rides above the resting song', drainedState.cards.length === 2 && drainedState.cards[0].y < drainedState.cards[1].y - 40, JSON.stringify(drainedState.cards.map((c) => Math.round(c.y))));
void drained;

const empty = await evalJs(`(() => {
  const A = window.__songActions;
  const lib = A.libraryTracks();
  A.setContext([lib.find((t) => t.id === ${JSON.stringify(picks[0].id)})], 0);
  return true;
})()`);
await sleep(600);
const emptyState = await evalJs(`(() => {
  const Q = window.__queueRiver;
  return { open: Q.isOpen(), cards: document.querySelectorAll('#queue-river .rv2-card').length, center: Q.centerId() };
})()`);
check('a resting queue of one: the song holds the center alone', empty === true && emptyState.open === true && emptyState.cards === 1 && emptyState.center === picks[0].id, JSON.stringify(emptyState));
await realEsc();
await sleep(950);
check('esc leaves the empty world', await evalJs(`window.__queueRiver.isOpen() === false`));

const longLine = await evalJs(`(() => {
  const A = window.__songActions;
  const lib = A.libraryTracks();
  const pick = [];
  const seen = new Set();
  for (const t of lib) { if (seen.has(t.id)) continue; seen.add(t.id); pick.push({ id: t.id }); if (pick.length === 21) break; }
  A.setContext(lib.filter((t) => pick.some((p) => p.id === t.id)), 0);
  return pick.map((p) => p.id);
})()`);
await sleep(850);
await realClick(qBtn.x, qBtn.y);
await sleep(1100);
const startShape = await evalJs(`(() => {
  const cards = [...document.querySelectorAll('#queue-river .rv2-card')]
    .map((el) => { const r = el.getBoundingClientRect(); const m = el.style.transform.match(/rotateX\\(([-0-9.]+)deg\\)/); return { id: el.dataset.id, i: Number(el.dataset.index), y: r.top + r.height / 2, tilt: m ? Number(m[1]) : null, vis: getComputedStyle(el).visibility }; })
    .filter((c) => c.vis === 'visible')
    .sort((a, b) => a.i - b.i);
  const slot = (window.innerHeight - 52 - 62) / 7;
  return {
    ids: window.__queueRiver.ids().length,
    center: window.__queueRiver.centerId(),
    gap01: cards.length >= 2 ? cards[1].y - cards[0].y : NaN,
    slot,
    visibleBelow: cards.length - 1,
    ghosts: window.__queueRiver.ghostIds().length,
    tilt2: Math.abs(cards.find((c) => c.i === 2)?.tilt ?? 0),
  };
})()`);
check('long line at its start: the playing song centers, no ghosts', startShape.center === longLine[0] && startShape.ids === 21 && startShape.ghosts === 0, JSON.stringify({ center: startShape.center, ids: startShape.ids }));
check('long line at its start: downward spacing is a normal river, not the end squash', startShape.gap01 > startShape.slot * 0.6, `gap ${(startShape.gap01 / startShape.slot).toFixed(2)} slot`);
check('long line at its start: several cards stay readable below center', startShape.visibleBelow >= 4, String(startShape.visibleBelow));
check('long line at its start: mid-line perspective intact', startShape.tilt2 > 18, `tilt ${startShape.tilt2.toFixed(1)} deg at two steps`);

const vp = await evalJs(`({ w: window.innerWidth, h: window.innerHeight })`);
for (let i = 0; i < 8; i++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(vp.w / 2), y: Math.round(vp.h / 2), deltaX: 0, deltaY: -400 });
  await sleep(90);
}
await sleep(2400);
const endShape = await evalJs(`(() => {
  const cards = [...document.querySelectorAll('#queue-river .rv2-card')];
  return {
    count: cards.length,
    scroll: window.__queueRiver.scroll(),
    ids: window.__queueRiver.ids(),
  };
})()`);
check('the line has no end: the wheel rolls past the last song into the wrap', endShape.scroll > 20.05 && endShape.count === 21 && endShape.ids.length === 21, JSON.stringify({ scroll: Number(endShape.scroll.toFixed(2)), count: endShape.count }));
await realEsc();
await sleep(950);
check('esc leaves the long line', await evalJs(`window.__queueRiver.isOpen() === false`));

await evalJs(`document.querySelector('[data-mode="albums"]').click()`);
await sleep(400);
await evalJs(`window.__songActions.libraryTracks()`);
await realClick(qBtn.x, qBtn.y);
await sleep(900);
const tabSwitch = await evalJs(`window.__queueRiver.isOpen()`);
await evalJs(`document.querySelector('[data-mode="songs"]').click()`);
await sleep(900);
const afterTab = await evalJs(`window.__queueRiver.isOpen()`);
check('tab change abandons the world', tabSwitch === true && afterTab === false, `before ${tabSwitch}, after ${afterTab}`);

if (failed > 0) {
  console.log(`FAIL: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('QUEUE RIVER VERIFIED');
socket.end();
process.exit(0);
