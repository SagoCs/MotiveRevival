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
await sleep(800);
check('v2 river live on Songs', await evalJs(`document.getElementById('river-v2').classList.contains('on') && document.body.classList.contains('song-river-active')`));
await evalJs(`document.querySelectorAll('[data-probe-pick]').forEach((c) => { delete c.dataset.probePick; })`);

const qState = await evalJs(`(() => { const s = window.__songActions.queueSnapshot(); return { up: s.upcoming.length, total: s.ids.length, lib: window.__songActions.libraryTracks().length }; })()`);
if (qState.up < 4) {
  await evalJs(`(() => {
    const A = window.__songActions;
    const tracks = A.libraryTracks();
    const base = Math.floor(tracks.length / 2);
    for (let i = 0; i < 8 && A.queueSnapshot().upcoming.length < 4; i++) {
      A.queueNext(tracks[base + i]);
    }
  })()`);
  await sleep(300);
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
const copiesBefore = await evalJs(`(() => {
  const id = document.querySelector('[data-probe-pick="1"]')?.dataset.id ?? '';
  return window.__songActions.queueSnapshot().ids.filter((x) => x === id).length;
})()`);
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
await sleep(400);
const forkWord = await evalJs(`(() => {
  const id = document.querySelector('[data-probe-pick="1"]')?.dataset.id ?? '';
  return {
    title: document.title,
    word: document.querySelector('.song-menu .sm-word')?.textContent ?? null,
    copies: window.__songActions.queueSnapshot().ids.filter((x) => x === id).length,
  };
})()`);
check('real mouse click reached the fork without playing the card', forkWord.title === titleBefore, JSON.stringify({ before: titleBefore, after: forkWord.title }));
check('add to queue on an upcoming song answers Already there and refuses to copy', forkWord.word === 'Already there' && forkWord.copies === copiesBefore && forkWord.copies === 1, JSON.stringify(forkWord));
await sleep(1100);
check('the word closes the menu', await evalJs(`document.querySelector('.song-menu') === null`));

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
await sleep(700);
const filingTakeover = await evalJs(`(() => {
  const title = document.querySelector('.shelf-lens-title');
  return {
    menuGone: document.querySelector('.song-menu') === null,
    filing: window.__shelf.filing(),
    title: title?.textContent ?? null,
    titleVisible: title !== null && getComputedStyle(title).display !== 'none',
    lensButtonsHidden: Array.from(document.querySelectorAll('#shelf-lens button')).every((b) => getComputedStyle(b).display === 'none'),
  };
})()`);
check('add to playlist hands off to the filing lens', filingTakeover.menuGone === true && filingTakeover.filing === true && filingTakeover.title === 'Choose a playlist' && filingTakeover.titleVisible === true && filingTakeover.lensButtonsHidden === true, JSON.stringify(filingTakeover));

await evalJs(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(900);
const filingCancelled = await evalJs(`(() => ({
  filing: window.__shelf.filing(),
  riverBack: document.getElementById('river-v2').classList.contains('on'),
  shelfHidden: !document.getElementById('shelf').classList.contains('on'),
}))()`);
check('escape cancels filing back to the origin river', filingCancelled.filing === false && filingCancelled.riverBack === true && filingCancelled.shelfHidden === true, JSON.stringify(filingCancelled));

await evalJs(`(async () => {
  const A = window.__songActions;
  for (const pl of A.playlists().filter((x) => x.name === '__probe_del')) await A.removePlaylist(pl.id);
})()`);

await evalJs(`(() => {
  document.getElementById('search-summon').click();
  const i = document.getElementById('oracle-input');
  i.focus();
  i.value = 'mili';
  i.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(600);
const songRowPicked = await evalJs(`(() => {
  const row = document.querySelector('#oracle-results .oracle-row.kind-song');
  if (row === null) return null;
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  return true;
})()`);
await sleep(350);
const chrome = await evalJs(`(() => {
  const m = document.querySelector('.song-menu');
  const row = document.querySelector('#oracle-results .oracle-row.kind-song');
  const mr = m?.getBoundingClientRect();
  const rr = row?.getBoundingClientRect();
  return {
    open: m !== null,
    chromeMount: m?.classList.contains('song-menu-chrome') ?? false,
    not3d: m?.classList.contains('song-menu-3d') ?? false,
    fork: m?.querySelector('.sm-fork') !== null,
    rightOfRow: mr !== null && rr !== null && mr.left > rr.left && mr.right <= window.innerWidth - 10,
    summonOpen: document.getElementById('search-oracle').classList.contains('open'),
  };
})()`);
check('summon song row mounts the chrome menu', songRowPicked === true && chrome.open === true && chrome.chromeMount === true && chrome.not3d === false && chrome.fork === true, JSON.stringify(chrome));
check('chrome menu sits right of the row inside the viewport', chrome.rightOfRow === true);
check('summon stays open under the menu', chrome.summonOpen === true);

await evalJs(`document.querySelector('#oracle-results .oracle-row.kind-song').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))`);
await sleep(400);
const toggled = await evalJs(`(() => ({
  menuGone: document.querySelector('.song-menu') === null,
  summonOpen: document.getElementById('search-oracle').classList.contains('open'),
}))()`);
check('same summon row toggles the menu closed', toggled.menuGone === true && toggled.summonOpen === true, JSON.stringify(toggled));

const nonSong = await evalJs(`(() => {
  const row = document.querySelector('#oracle-results .oracle-row:not(.kind-song)');
  if (row === null) return { found: false };
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  return { found: true, noMenu: document.querySelector('.song-menu') === null };
})()`);
check('non-song summon rows decline the menu', nonSong.found === false || (nonSong.found === true && nonSong.noMenu === true), JSON.stringify(nonSong));

await evalJs(`(() => {
  const row = document.querySelector('#oracle-results .oracle-row.kind-song');
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
})()`);
await sleep(350);
await evalJs(`(() => {
  const i = document.getElementById('oracle-input');
  i.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
})()`);
await sleep(350);
const kb = await evalJs(`(() => ({
  menuGone: document.querySelector('.song-menu') === null,
  summonOpen: document.getElementById('search-oracle').classList.contains('open'),
}))()`);
check('summon keyboard activity closes the menu', kb.menuGone === true && kb.summonOpen === true, JSON.stringify(kb));

await evalJs(`(async () => {
  const A = window.__songActions;
  for (const pl of A.playlists().filter((x) => x.name === '__probe_add')) await A.removePlaylist(pl.id);
  const rowTitle = document.querySelector('#oracle-results .oracle-row.kind-song .song-title')?.textContent ?? '';
  const track = A.libraryTracks().find((t) => t.title !== rowTitle) ?? A.libraryTracks()[0];
  await A.createPlaylistWithTrack('__probe_add', track);
})()`);
await sleep(400);
await evalJs(`(() => {
  const row = document.querySelector('#oracle-results .oracle-row.kind-song');
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
})()`);
await sleep(350);
const forkRow = await evalJs(`(() => {
  const b = Array.from(document.querySelectorAll('.sm-fork-btn')).find((x) => x.textContent === 'Add to queue');
  if (b === undefined) return null;
  const r = b.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`);
if (forkRow !== null) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: forkRow.x, y: forkRow.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: forkRow.x, y: forkRow.y, button: 'left', clickCount: 1 });
}
await sleep(350);
const realPressFork = await evalJs(`(() => ({
  word: document.querySelector('.song-menu .sm-word')?.textContent ?? null,
  menuOpen: document.querySelector('.song-menu') !== null,
  summonOpen: document.getElementById('search-oracle').classList.contains('open'),
}))()`);
check('real press on the fork answers with the word and keeps the summon open', realPressFork.word !== null && realPressFork.menuOpen === true && realPressFork.summonOpen === true, JSON.stringify(realPressFork));
await sleep(1200);
await evalJs(`(() => {
  const row = document.querySelector('#oracle-results .oracle-row.kind-song');
  if (row !== null) row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
})()`);
await sleep(350);
const forkRow2 = await evalJs(`(() => {
  const b = Array.from(document.querySelectorAll('.sm-fork-btn')).find((x) => x.textContent === 'Add to playlist');
  if (b === undefined) return null;
  const r = b.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`);
if (forkRow2 !== null) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: forkRow2.x, y: forkRow2.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: forkRow2.x, y: forkRow2.y, button: 'left', clickCount: 1 });
}
await sleep(700);
const realFile = await evalJs(`(() => ({
  menuGone: document.querySelector('.song-menu') === null,
  summonClosed: !document.getElementById('search-oracle').classList.contains('open'),
  filing: window.__shelf.filing(),
}))()`);
check('add to playlist closes the summon and opens filing', realFile.menuGone === true && realFile.summonClosed === true && realFile.filing === true, JSON.stringify(realFile));
await evalJs(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(900);
check('escape leaves the filing lens clean', await evalJs(`window.__shelf.filing() === false`));
await evalJs(`(async () => {
  const A = window.__songActions;
  for (const pl of A.playlists().filter((x) => x.name === '__probe_add')) await A.removePlaylist(pl.id);
})()`);
await sleep(1000);

await evalJs(`(() => {
  document.getElementById('search-summon').click();
  const i = document.getElementById('oracle-input');
  i.focus();
  i.value = 'mili';
  i.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(700);
await evalJs(`(() => {
  const row = document.querySelector('#oracle-results .oracle-row.kind-song');
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
})()`);
await sleep(350);
await evalJs(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(400);
const layered = await evalJs(`(() => ({
  menuGone: document.querySelector('.song-menu') === null,
  summonOpen: document.getElementById('search-oracle').classList.contains('open'),
}))()`);
check('escape closes the menu but not the summon', layered.menuGone === true && layered.summonOpen === true, JSON.stringify(layered));
await evalJs(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(400);
check('second escape closes the summon', await evalJs(`!document.getElementById('search-oracle').classList.contains('open')`));

const transport = await evalJs(`(() => {
  document.querySelector('.queue-toggle').click();
  return {
    menu: document.querySelector('.song-menu') !== null,
    world: window.__queueRiver !== undefined && window.__queueRiver.isOpen(),
    lit: document.querySelector('.queue-toggle').classList.contains('lit'),
  };
})()`);
await sleep(800);
check('transport button opens the queue river world, not a menu', transport.world === true && transport.menu === false && transport.lit === true, JSON.stringify(transport));
await evalJs(`window.__queueRiver.close()`);
await sleep(700);
check('closing the world unlights the button', await evalJs(`!document.querySelector('.queue-toggle').classList.contains('lit')`));

await evalJs(`document.querySelector('#mode-tabs button[data-mode="albums"]').click()`);
await sleep(500);
await evalJs(`document.querySelector('.album-card')?.click()`);
await sleep(700);
await evalJs(`(() => {
  const cell = document.querySelector('#detail-layer .mini-cell');
  if (cell !== null) cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
})()`);
await sleep(350);
const stage = await evalJs(`(() => {
  const m = document.querySelector('.song-menu');
  return {
    open: m !== null,
    chromeMount: m?.classList.contains('song-menu-chrome') ?? false,
    fork: m?.querySelector('.sm-fork') !== null,
    overStage: m !== null,
  };
})()`);
check('stage cell mounts the chrome menu', stage.open === true && stage.chromeMount === true && stage.fork === true, JSON.stringify(stage));
await evalJs(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(300);
await evalJs(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(400);

console.log(failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
