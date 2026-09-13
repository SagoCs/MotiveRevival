import net from 'node:net';
import crypto from 'node:crypto';

const port = process.env.MENU_PORT ?? '9222';
setTimeout(() => { console.error('watchdog'); process.exit(2); }, 120000).unref();

let page = null;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 700));
  try {
    const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
    page = targets.find((t) => t.type === 'page');
    if (page) break;
  } catch {}
}
if (!page) throw new Error('no page target');

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
  if (!ok) failed++;
};

await send('Page.enable');
await send('Runtime.enable');
for (let i = 0; i < 20; i++) {
  const ready = await evalJs(`!!document.querySelector('#mode-tabs button') && !!window.__songActions`);
  if (ready) break;
  await sleep(700);
}

await evalJs(`document.querySelector('#mode-tabs button[data-mode="songs"]').click()`);
await sleep(500);
await evalJs(`if (!document.body.classList.contains('river-v2-active')) document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'F9', bubbles: true }))`);
await sleep(800);
check('v2 river live (F9)', await evalJs(`document.body.classList.contains('river-v2-active')`));

const glide = await evalJs(`(() => {
  const lab = window.__riverV2Lab;
  if (lab === undefined || lab.river() === null) return null;
  const upcoming = window.__songActions.queueSnapshot().upcoming;
  if (upcoming.length === 0) return null;
  const tracks = window.__songActions.libraryTracks();
  const idx = tracks.findIndex((t) => t.id === upcoming[upcoming.length - 1]);
  if (idx < 0) return null;
  lab.river().glideTo(idx);
  return idx;
})()`);
await sleep(1300);
let card = null;
for (let attempt = 0; attempt < 10 && card === null; attempt++) {
  card = await evalJs(`(() => {
    const cards = Array.from(document.querySelectorAll('.rv2-card'));
    const upcoming = new Set(window.__songActions.queueSnapshot().upcoming);
    const visible = cards.filter((c) => { const r = c.getBoundingClientRect(); return r.width > 150 && r.height > 30 && !c.classList.contains('committed') && upcoming.has(c.dataset.id); });
    const c = visible.sort((a, b) => Math.abs(a.getBoundingClientRect().left + a.getBoundingClientRect().width / 2 - window.innerWidth / 2) - Math.abs(b.getBoundingClientRect().left + b.getBoundingClientRect().width / 2 - window.innerWidth / 2))[0];
    if (c === undefined) return null;
    c.dataset.probePick = '1';
    c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    const menu = c.querySelector(':scope > .song-menu');
    return menu !== null ? { id: c.dataset.id, title: c.querySelector('.rv2-title')?.textContent ?? '' } : null;
  })()`);
  if (card === null) {
    await evalJs(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await sleep(500);
  }
}
check('right-click mounts the panel on a visible upcoming card', card !== null, card ? card.title : 'no candidate found');
await sleep(350);
const menu = await evalJs(`(() => {
  const card = document.querySelector('[data-probe-pick="1"]');
  const m = card?.querySelector(':scope > .song-menu');
  const btns = m ? Array.from(m.querySelectorAll('.sm-fork-btn')).map((b) => b.textContent) : [];
  return { mounted: m !== null, is3d: m?.classList.contains('song-menu-3d') ?? false, on: m?.classList.contains('on') ?? false, btns };
})()`);
check('right-click materializes the panel inside the card', menu.mounted === true && menu.is3d === true && menu.on === true);
check('fork shows the two intents', JSON.stringify(menu.btns) === JSON.stringify(['Add to queue', 'Add to playlist']), JSON.stringify(menu.btns));

await evalJs(`(() => { const b = Array.from(document.querySelectorAll('.sm-fork-btn')).find((x) => x.textContent === 'Add to queue'); b.click(); })()`);
await sleep(350);
const queuePhase = await evalJs(`(() => {
  const m = document.querySelector('.song-menu');
  if (m === null) return { open: false };
  const head = m.querySelector('.sm-head')?.textContent ?? '';
  const rows = m.querySelectorAll('.sm-list .sm-row').length;
  const newCount = m.querySelectorAll('.sm-row.sm-new').length;
  const newName = m.querySelector('.sm-row.sm-new .sm-name')?.textContent ?? '';
  return { open: true, head, rows, newCount, newName };
})()`);
check('queue path opens the live queue view', queuePhase.open === true && queuePhase.head === 'UP NEXT' && queuePhase.rows > 0, JSON.stringify({ head: queuePhase.head, rows: queuePhase.rows }));
check('queue view highlights the card song (dedupe, no flood)', queuePhase.newCount === 1 && queuePhase.newName === card.title, JSON.stringify({ newCount: queuePhase.newCount, newName: queuePhase.newName }));

const qAfter = await evalJs(`(() => { const s = window.__songActions.queueSnapshot(); return { total: s.ids.length, copies: s.ids.filter((x) => x === ${JSON.stringify(card.id)}).length }; })()`);
check('no duplicate entered the queue', qAfter.copies === 1, JSON.stringify(qAfter));

const drag = await evalJs(`(() => {
  const m = document.querySelector('.song-menu');
  const row = m.querySelector('.sm-list .sm-row');
  const rect = row.getBoundingClientRect();
  const before = window.__songActions.queueSnapshot().upcoming.slice(0, 4);
  const y0 = rect.top + rect.height / 2;
  const bottom = m.querySelector('.sm-list .sm-row:nth-child(4)').getBoundingClientRect();
  const yFar = bottom.top + bottom.height / 2;
  row.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: rect.left + 20, clientY: y0, bubbles: true }));
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: rect.left + 20, clientY: y0 + 40 }));
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: rect.left + 20, clientY: yFar }));
  window.dispatchEvent(new PointerEvent('pointerup', { clientX: rect.left + 20, clientY: yFar }));
  const after = window.__songActions.queueSnapshot().upcoming;
  const movedOff = after[0] !== before[0];
  const stillThere = after.includes(before[0]);
  const sameSet = JSON.stringify(after.slice(0, 4).slice().sort()) === JSON.stringify(before.slice().sort());
  if (movedOff && stillThere) window.__songActions.queueMoveToGap(after.indexOf(before[0]), 0);
  const restored = window.__songActions.queueSnapshot().upcoming.slice(0, 4);
  return { movedOff, stillThere, sameSet, restored: JSON.stringify(restored) === JSON.stringify(before) };
})()`);
check('drag reorder moves the row and restores', drag.movedOff === true && drag.stillThere === true && drag.sameSet === true && drag.restored === true, JSON.stringify(drag));

await evalJs(`(() => { const x = document.querySelector('.song-menu .sm-row.sm-new .sm-x'); if (x) x.click(); })()`);
await sleep(300);
const removed = await evalJs(`window.__songActions.queueSnapshot().ids.filter((x) => x === ${JSON.stringify(card.id)}).length`);
check('row x removes from the queue', removed === 0);

await evalJs(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(400);
check('escape closes the panel', await evalJs(`document.querySelector('.song-menu') === null`));

await evalJs(`(() => {
  const cards = Array.from(document.querySelectorAll('.rv2-card'));
  const c = cards.find((x) => x.dataset.probePick === '1') ?? cards.find((x) => { const r = x.getBoundingClientRect(); return r.width > 150 && r.height > 30 && !x.classList.contains('committed'); });
  if (c !== undefined) { c.dataset.probePick = '1'; c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); }
})()`);
await sleep(350);
await evalJs(`(() => { const b = Array.from(document.querySelectorAll('.sm-fork-btn')).find((x) => x.textContent === 'Add to playlist'); if (b !== undefined) b.click(); })()`);
await sleep(350);
const plPhase = await evalJs(`(() => {
  const m = document.querySelector('.song-menu');
  const head = m?.querySelector('.sm-head')?.textContent ?? '';
  const rows = m ? m.querySelectorAll('.sm-list .sm-row').length : 0;
  const firstName = m?.querySelector('.sm-list .sm-row .sm-name')?.textContent ?? '';
  return { head, rows, firstName };
})()`);
check('playlist path lists playlists with New playlist first', plPhase.head === 'ADD TO PLAYLIST' && plPhase.rows > 0 && plPhase.firstName === 'New playlist', JSON.stringify(plPhase));

await evalJs(`(() => { document.querySelector('.sm-row-new').click(); })()`);
await sleep(250);
const typing = await evalJs(`(async () => {
  for (let i = 0; i < 12; i++) {
    const input = document.querySelector('.sm-input');
    if (input !== null) {
      input.value = '__probe_scratch';
      return { typing: true, focused: document.activeElement === input };
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return { typing: false };
})()`);
check('new playlist opens a focused typing field', typing.typing === true && typing.focused === true, JSON.stringify(typing));

await evalJs(`document.querySelector('.sm-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
await sleep(500);
const added = await evalJs(`(() => {
  const word = document.querySelector('.song-menu .sm-word')?.textContent ?? '';
  const pl = window.__songActions.playlists().find((x) => x.name === '__probe_scratch');
  return { word, created: pl !== undefined };
})()`);
check('enter commits the new playlist (Added)', added.word === 'Added' && added.created === true, JSON.stringify(added));
await sleep(900);
check('panel fades out after the word', await evalJs(`document.querySelector('.song-menu') === null`));

const cleanup = await evalJs(`(() => {
  const pl = window.__songActions.playlists().find((x) => x.name === '__probe_scratch');
  return pl === undefined ? Promise.resolve(false) : window.__songActions.removePlaylist(pl.id).then(() => true);
})()`);
check('scratch playlist cleaned up', cleanup === true);

console.log(failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
