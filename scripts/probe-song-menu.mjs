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
await evalJs(`document.querySelectorAll('[data-probe-pick]').forEach((c) => { delete c.dataset.probePick; })`);

const qState = await evalJs(`(() => { const s = window.__songActions.queueSnapshot(); return { up: s.upcoming.length, total: s.ids.length, lib: window.__songActions.libraryTracks().length }; })()`);
if (qState.up === 0 || qState.total !== qState.lib) {
  await evalJs(`(() => {
    const lab = window.__riverV2Lab;
    const count = window.__songActions.libraryTracks().length;
    lab?.river()?.glideTo(Math.floor(count / 2));
  })()`);
  await sleep(1400);
  const tap = await evalJs(`(() => {
    const playing = window.__riverV2Lab?.playingId?.() ?? null;
    const cards = Array.from(document.querySelectorAll('.rv2-card'));
    const c = cards.find((x) => x.dataset.id !== playing && x.getBoundingClientRect().height > 60);
    if (c === undefined) return null;
    const r = c.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (tap !== null) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: tap.x, y: tap.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tap.x, y: tap.y, button: 'left', clickCount: 1 });
    await sleep(700);
    await evalJs(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await sleep(400);
  }
}

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
    const tallest = Math.max(...cards.map((c) => c.getBoundingClientRect().height));
    const visible = cards.filter((c) => { const r = c.getBoundingClientRect(); return r.width > 150 && r.height > tallest * 0.62 && !c.classList.contains('committed') && upcoming.has(c.dataset.id); });
    const c = visible.sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
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

const geo = await evalJs(`(() => {
  const card = document.querySelector('[data-probe-pick="1"]');
  const m = card?.querySelector(':scope > .song-menu');
  if (m === null) return null;
  const cr = card.getBoundingClientRect();
  const mr = m.getBoundingClientRect();
  const fork = m.querySelector('.sm-fork')?.getBoundingClientRect();
  return {
    w: mr.width,
    hGap: Math.abs(mr.height - cr.height),
    centerOff: fork ? Math.abs((fork.top + fork.height / 2) - (mr.top + mr.height / 2)) : -1,
  };
})()`);
check('panel width is 280 in card space', geo !== null && geo.w > 275 && geo.w < 305, geo ? `w=${geo.w.toFixed(1)}` : 'no menu');
check('panel stretches to the full card height', geo !== null && geo.hGap < 4, geo ? `gap=${geo.hGap.toFixed(2)}` : 'no menu');
check('fork sits centered in the tall panel', geo !== null && geo.centerOff >= 0 && geo.centerOff < 8, geo ? `off=${geo.centerOff.toFixed(1)}` : 'no menu');

const swallow = await evalJs(`(() => {
  const m = document.querySelector('.song-menu');
  if (m === null) return { open: false };
  m.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  return { open: true };
})()`);
await sleep(400);
const swallowAfter = await evalJs(`(() => {
  const m = document.querySelector('.song-menu');
  return { alive: m !== null, fork: m?.querySelector('.sm-fork') !== null };
})()`);
check('right-click inside the panel leaves it alone', swallow.open === true && swallowAfter.alive === true && swallowAfter.fork === true, JSON.stringify(swallowAfter));

const titleBefore = await evalJs(`document.title`);
const copiesBefore = await evalJs(`window.__songActions.queueSnapshot().ids.filter((x) => x === document.querySelector('[data-probe-pick="1"]')?.dataset.id).length`);
const forkBtn = await evalJs(`(() => {
  const b = Array.from(document.querySelectorAll('.sm-fork-btn')).find((x) => x.textContent === 'Add to queue');
  if (b === undefined) return null;
  const r = b.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`);
if (forkBtn !== null) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: forkBtn.x, y: forkBtn.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: forkBtn.x, y: forkBtn.y, button: 'left', clickCount: 1 });
}
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
const titleAfterQueue = await evalJs(`document.title`);
check('real mouse click reached the button without playing the card', queuePhase.open === true && titleAfterQueue === titleBefore, JSON.stringify({ titleBefore, titleAfterQueue }));
const topOfQueue = await evalJs(`window.__songActions.queueSnapshot().upcoming[0]`);
check('add to queue pulls the card song to plays-next', topOfQueue === card.id, JSON.stringify({ topOfQueue, cardId: card.id }));
check('queue view highlights the card song (dedupe, no flood)', queuePhase.newCount === 1 && queuePhase.newName === card.title, JSON.stringify({ newCount: queuePhase.newCount, newName: queuePhase.newName }));

const qAfter = await evalJs(`(() => { const s = window.__songActions.queueSnapshot(); const id = document.querySelector('[data-probe-pick="1"]')?.dataset.id ?? ''; return { total: s.ids.length, copies: s.ids.filter((x) => x === id).length }; })()`);
check('no duplicate entered the queue', qAfter.copies === copiesBefore, JSON.stringify({ copiesBefore, after: qAfter }));

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
const backTo = await evalJs(`(() => {
  const m = document.querySelector('.song-menu');
  return { open: m !== null, fork: m?.querySelector('.sm-fork') !== null, list: m?.querySelector('.sm-list') !== null };
})()`);
check('escape steps back from the queue to the fork', backTo.open === true && backTo.fork === true && backTo.list === false, JSON.stringify(backTo));

const race = await evalJs(`(() => {
  const c = Array.from(document.querySelectorAll('.rv2-card')).find((x) => x.dataset.probePick === '1');
  if (c === undefined) return { picked: false };
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  const openNow = c.querySelector(':scope > .song-menu') !== null;
  return { picked: true, openNow };
})()`);
await sleep(450);
const raceAfter = await evalJs(`(() => {
  const m = document.querySelector('.song-menu');
  return { alive: m !== null, on: m?.classList.contains('on') ?? false };
})()`);
check('re-opening during the close fade survives', race.picked === true && race.openNow === true && raceAfter.alive === true && raceAfter.on === true, JSON.stringify({ ...race, ...raceAfter }));

await evalJs(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(400);

const guard = await evalJs(`(async () => {
  const lab = window.__riverV2Lab;
  const count = window.__songActions.libraryTracks().length;
  lab.river().glideTo(Math.floor(count / 2));
  await new Promise((r) => setTimeout(r, 1400));
  const cards = Array.from(document.querySelectorAll('.rv2-card'));
  const tallest = Math.max(...cards.map((c) => c.getBoundingClientRect().height));
  const band = cards.filter((c) => { const h = c.getBoundingClientRect().height; return h > tallest * 0.2 && h < tallest * 0.45; });
  const c = band[0];
  if (c === undefined) return { found: false };
  c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  return { found: true, h: Math.round(c.getBoundingClientRect().height), tallest: Math.round(tallest), anyMenu: document.querySelector('.song-menu') !== null };
})()`);
check('cards below the readability line decline the menu', guard.found === true && guard.anyMenu === false, JSON.stringify(guard));

const toggle = await evalJs(`(() => {
  const cards = Array.from(document.querySelectorAll('.rv2-card'));
  const tallest = Math.max(...cards.map((c) => c.getBoundingClientRect().height));
  const c = cards.filter((x) => { const r = x.getBoundingClientRect(); return r.height > tallest * 0.62 && !x.classList.contains('committed'); }).sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
  if (c === undefined) return { picked: false };
  c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  const first = c.querySelector(':scope > .song-menu') !== null;
  c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  return { picked: true, first };
})()`);
await sleep(400);
const toggleGone = await evalJs(`document.querySelector('.song-menu') === null`);
check('right-click the same card toggles closed', toggle.picked === true && toggle.first === true && toggleGone === true, JSON.stringify(toggle));

await evalJs(`(() => {
  const cards = Array.from(document.querySelectorAll('.rv2-card'));
  const tallest = Math.max(...cards.map((c) => c.getBoundingClientRect().height));
  const c = cards.filter((x) => { const r = x.getBoundingClientRect(); return r.width > 150 && r.height > tallest * 0.62 && !x.classList.contains('committed'); }).sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
  if (c !== undefined) { c.dataset.probePick = '1'; c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); }
})()`);
await sleep(350);
const plBtn = await evalJs(`(() => {
  const b = Array.from(document.querySelectorAll('.sm-fork-btn')).find((x) => x.textContent === 'Add to playlist');
  if (b === undefined) return null;
  const r = b.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`);
if (plBtn !== null) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: plBtn.x, y: plBtn.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: plBtn.x, y: plBtn.y, button: 'left', clickCount: 1 });
}
await sleep(350);
const plPhase = await evalJs(`(() => {
  const m = document.querySelector('.song-menu');
  const head = m?.querySelector('.sm-head')?.textContent ?? '';
  const rows = m ? m.querySelectorAll('.sm-list .sm-row').length : 0;
  const firstName = m?.querySelector('.sm-list .sm-row .sm-name')?.textContent ?? '';
  return { head, rows, firstName };
})()`);
check('playlist path lists playlists with New playlist first', plPhase.head === 'ADD TO PLAYLIST' && plPhase.rows > 0 && plPhase.firstName === 'New playlist', JSON.stringify(plPhase));

await evalJs(`(async () => {
  const A = window.__songActions;
  for (const pl of A.playlists().filter((x) => x.name === '__probe_del')) await A.removePlaylist(pl.id);
  const track = A.libraryTracks().find((t) => t.id === A.queueSnapshot().ids[0]);
  await A.createPlaylistWithTrack('__probe_del', track);
})()`);
await sleep(400);
const xBtn = await evalJs(`(() => {
  const rows = Array.from(document.querySelectorAll('.sm-list .sm-row'));
  const row = rows.find((r) => r.querySelector('.sm-name')?.textContent === '__probe_del');
  const x = row?.querySelector('.sm-x');
  if (x === undefined || x === null) return null;
  row.scrollIntoView({ block: 'nearest' });
  const r = x.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`);
if (xBtn !== null) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: xBtn.x, y: xBtn.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: xBtn.x, y: xBtn.y, button: 'left', clickCount: 1 });
}
await sleep(350);
const inline = await evalJs(`(() => {
  const m = document.querySelector('.song-menu');
  const btns = m ? Array.from(m.querySelectorAll('.sm-confirm-pair .sm-mini')).map((b) => b.textContent) : [];
  return { head: m?.querySelector('.sm-head')?.textContent ?? null, btns, nameKept: m?.querySelector('.sm-confirming .sm-name')?.textContent ?? null };
})()`);
check('delete confirm arms inline on the row', inline.head === 'ADD TO PLAYLIST' && JSON.stringify(inline.btns) === JSON.stringify(['Confirm', 'Cancel']) && inline.nameKept === '__probe_del', JSON.stringify(inline));

const cancelBtn = await evalJs(`(() => {
  const b = Array.from(document.querySelectorAll('.sm-mini')).find((x) => x.textContent === 'Cancel');
  if (b === undefined) return null;
  const r = b.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`);
if (cancelBtn !== null) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cancelBtn.x, y: cancelBtn.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cancelBtn.x, y: cancelBtn.y, button: 'left', clickCount: 1 });
}
await sleep(350);
const afterCancel = await evalJs(`(() => {
  const m = document.querySelector('.song-menu');
  const rows = Array.from(m?.querySelectorAll('.sm-list .sm-row') ?? []);
  return { pairGone: m?.querySelector('.sm-confirm-pair') === null, rowBack: rows.some((r) => r.querySelector('.sm-name')?.textContent === '__probe_del') };
})()`);
check('cancel returns to the list with the playlist intact', afterCancel.pairGone === true && afterCancel.rowBack === true, JSON.stringify(afterCancel));

const xBtn2 = await evalJs(`(() => {
  const rows = Array.from(document.querySelectorAll('.sm-list .sm-row'));
  const row = rows.find((r) => r.querySelector('.sm-name')?.textContent === '__probe_del');
  const x = row?.querySelector('.sm-x');
  if (x === undefined || x === null) return null;
  row.scrollIntoView({ block: 'nearest' });
  const r = x.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`);
if (xBtn2 !== null) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: xBtn2.x, y: xBtn2.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: xBtn2.x, y: xBtn2.y, button: 'left', clickCount: 1 });
}
await sleep(300);
const confirmBtn = await evalJs(`(() => {
  const b = Array.from(document.querySelectorAll('.sm-mini')).find((x) => x.textContent === 'Confirm');
  if (b === undefined) return null;
  const r = b.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`);
if (confirmBtn !== null) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: confirmBtn.x, y: confirmBtn.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: confirmBtn.x, y: confirmBtn.y, button: 'left', clickCount: 1 });
}
await sleep(300);
const deleting = await evalJs(`(() => {
  const m = document.querySelector('.song-menu');
  const row = m?.querySelector('.sm-deleted');
  return { menuOpen: m !== null, word: row?.querySelector('.sm-deleted-word')?.textContent ?? null };
})()`);
check('confirm speaks Deleted on the row with the menu staying open', deleting.menuOpen === true && deleting.word === 'Deleted', JSON.stringify(deleting));
await sleep(1300);
const settled = await evalJs(`(() => {
  const m = document.querySelector('.song-menu');
  return { menuOpen: m !== null, animating: m?.querySelector('.sm-deleted') !== null, gone: window.__songActions.playlists().every((x) => x.name !== '__probe_del') };
})()`);
check('deleted row fades out and the list settles', settled.menuOpen === true && settled.animating === false && settled.gone === true, JSON.stringify(settled));

await evalJs(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(350);
const plBtn2 = await evalJs(`(() => {
  const b = Array.from(document.querySelectorAll('.sm-fork-btn')).find((x) => x.textContent === 'Add to playlist');
  if (b === undefined) return null;
  const r = b.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`);
if (plBtn2 !== null) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: plBtn2.x, y: plBtn2.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: plBtn2.x, y: plBtn2.y, button: 'left', clickCount: 1 });
}
await sleep(350);

const newRow = await evalJs(`(() => {
  const r = document.querySelector('.sm-row-new')?.getBoundingClientRect();
  return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
})()`);
if (newRow !== null) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: newRow.x, y: newRow.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: newRow.x, y: newRow.y, button: 'left', clickCount: 1 });
}
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
