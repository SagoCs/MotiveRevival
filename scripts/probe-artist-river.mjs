const targets = await fetch('http://127.0.0.1:9222/json').then((r) => r.json());
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('no page target');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = () => rej(new Error('ws error'));
});

let nextId = 1;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id !== undefined && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) rej(new Error(JSON.stringify(msg.error)));
    else res(msg.result);
  }
};

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evalJs(expr, awaitPromise = false) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result?.value;
}

const failures = [];

console.log('title:', await evalJs('document.title'));
await send('Page.enable');
await send('Page.reload');
await sleep(2500);
await evalJs(`document.querySelector('#mode-tabs button[data-mode="shelf"]')?.click()`);
await sleep(1500);
const bootUpcoming = await evalJs(`window.__songActions.queueSnapshot().upcoming.length`);
const libCount = await evalJs(`window.__songActions.libraryTracks().length`);
console.log(`boot queue: upcoming ${bootUpcoming} of ${libCount} library tracks`);
if (bootUpcoming > libCount / 2) failures.push(`queue looks like a legacy library context (${bootUpcoming} of ${libCount}) — the session transition leaked`);
await evalJs(`window.__shelf.goto(window.__shelf.center())`);
await sleep(900);

const selected = await evalJs(`window.__shelf.selected()`);
if (selected === null) failures.push('shelf has no focused artist to enter');
const rect = await evalJs(`(() => { const id = window.__shelf.selected(); const r = id !== null ? window.__shelf.rect(id) : null; return r ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null; })()`);
if (rect === null) {
  console.log('FAIL: no focused card rect to click');
  process.exit(1);
}
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
await sleep(800);

const opened = await evalJs(`(() => {
  const root = document.querySelector('#artist-river');
  return {
    open: window.__artistRiver.isOpen(),
    dom: root !== null && root.classList.contains('on'),
    shelfHidden: !window.__shelf.visible(),
    artist: window.__artistRiver.artist(),
  };
})()`);
console.log(`open: river=${opened.open} dom=${opened.dom} shelfHidden=${opened.shelfHidden} artist="${opened.artist}"`);
if (!opened.open || !opened.dom) failures.push('artist river did not open from center-click');
if (!opened.shelfHidden) failures.push('shelf did not hide under the artist river');

const feed = await evalJs(`({ albums: window.__artistRiver.albums(), years: window.__artistRiver.years(), nos: window.__artistRiver.trackNos(), scroll: window.__artistRiver.scroll(), n: window.__artistRiver.titles().length })`);
console.log(`feed: ${feed.n} songs, ${new Set(feed.albums).size} albums, scroll ${feed.scroll}`);
if (feed.n === 0) failures.push('feed is empty');
if (feed.scroll !== 0) failures.push(`river did not start at the top (scroll ${feed.scroll})`);
let bandsContiguous = true;
for (let i = 1; i < feed.albums.length; i++) {
  if (feed.albums[i] !== feed.albums[i - 1] && feed.albums.slice(0, i).includes(feed.albums[i])) bandsContiguous = false;
}
if (!bandsContiguous) failures.push('album bands are not contiguous');
let yearsDown = true;
for (let i = 1; i < feed.albums.length; i++) {
  if (feed.albums[i] !== feed.albums[i - 1] && (feed.years[i] ?? -1) > (feed.years[i - 1] ?? -1)) yearsDown = false;
}
if (!yearsDown) failures.push('albums not ordered newest-first');
let trackOrder = true;
for (let i = 1; i < feed.albums.length; i++) {
  if (feed.albums[i] === feed.albums[i - 1] && (feed.nos[i] ?? 0) < (feed.nos[i - 1] ?? 0)) trackOrder = false;
}
if (!trackOrder) failures.push('track numbers not ascending within albums');

const tones = await evalJs(`(() => {
  const byAlbum = new Map();
  for (const el of document.querySelectorAll('#artist-river .rv2-card')) {
    const idx = Number(el.dataset.index);
    const album = window.__artistRiver.albums()[idx];
    const tone = el.style.getPropertyValue('--rv2-tone').trim();
    if (!byAlbum.has(album)) byAlbum.set(album, new Set());
    byAlbum.get(album).add(tone);
  }
  const out = [];
  for (const [album, set] of byAlbum) out.push({ album, tones: [...set] });
  return out;
})()`);
const distinctTones = new Set(tones.flatMap((a) => a.tones)).size;
const consistentTones = tones.every((a) => a.tones.length === 1);
console.log(`tones: ${distinctTones} distinct across ${tones.length} albums, per-album consistent=${consistentTones}`);
if (tones.length >= 2 && distinctTones < 2) failures.push('albums do not carry distinct tones');
if (!consistentTones) failures.push('tone is not consistent within an album');

const twoLine = await evalJs(`(() => { const c = document.querySelector('#artist-river .rv2-card'); return c === null ? null : { title: c.querySelector('.rv2-title')?.textContent ?? null, meta: c.querySelector('.rv2-meta')?.textContent ?? null }; })()`);
console.log(`card text: "${twoLine.title}" — "${twoLine.meta}"`);
if (twoLine.title === null || twoLine.meta === null || twoLine.meta === '') failures.push('card is not two-line (song + album)');

const vw = await evalJs('innerWidth');
const cy = await evalJs(`Math.round(52 + (innerHeight - 52 - 62) / 2)`);
const clickTarget = await evalJs(`(() => {
  const cards = [...document.querySelectorAll('#artist-river .rv2-card')];
  let best = null;
  for (const el of cards) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const d = Math.abs(r.top + r.height / 2 - ${cy});
    if (best === null || d < best.d) best = { d, id: el.dataset.id, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }
  return best;
})()`);
const clickCardId = clickTarget !== null ? clickTarget.id : null;
const queueBefore = await evalJs(`window.__songActions.queueSnapshot().upcoming.length`);
const wasPending = await evalJs(`window.__songActions.queueSnapshot().upcoming.includes(${JSON.stringify(clickCardId)})`);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: clickTarget.x, y: clickTarget.y, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: clickTarget.x, y: clickTarget.y, button: 'left', clickCount: 1 });
await sleep(1000);
const afterClick = await evalJs(`(() => {
  const snap = window.__songActions.queueSnapshot();
  return { current: snap.ids[snap.index] ?? null, upcoming: snap.upcoming.length, committed: document.querySelector('#artist-river .rv2-card.committed')?.dataset.id ?? null };
})()`);
const expectedUpcoming = wasPending ? queueBefore - 1 : queueBefore;
console.log(`click: current=${afterClick.current === clickCardId ? 'clicked song' : afterClick.current}, upcoming ${queueBefore} -> ${afterClick.upcoming} (pending duplicate consumed: ${wasPending}), committed=${afterClick.committed === clickCardId ? 'clicked song' : afterClick.committed}`);
if (afterClick.current !== clickCardId) failures.push('click did not play the clicked song');
if (afterClick.upcoming !== expectedUpcoming) failures.push(`click law violated (upcoming ${queueBefore} -> ${afterClick.upcoming}, expected ${expectedUpcoming})`);
if (afterClick.committed !== clickCardId) failures.push('clicked card did not wear the committed bloom');

await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await sleep(1500);
const afterEsc = await evalJs(`(() => {
  const names = window.__shelf.names();
  return { open: window.__artistRiver.isOpen(), shelfVisible: window.__shelf.visible(), centerName: names[window.__shelf.center()], leftArtist: ${JSON.stringify(opened.artist)} };
})()`);
console.log(`escape: closed=${!afterEsc.open}, shelf=${afterEsc.shelfVisible}, center="${afterEsc.centerName}" (came from "${afterEsc.leftArtist}")`);
if (afterEsc.open) failures.push('escape did not close the artist river');
if (!afterEsc.shelfVisible) failures.push('shelf did not return after escape');
if (afterEsc.centerName !== afterEsc.leftArtist) failures.push(`shelf did not re-center on the artist just left (center ${afterEsc.centerName})`);

const artistNames = await evalJs('window.__shelf.names()');
let worst = { artist: null, albums: 0 };
for (const name of artistNames) {
  const ok = await evalJs(`window.__artistRiver.open(${JSON.stringify(name)})`);
  if (!ok) {
    failures.push(`feed empty for artist "${name}"`);
    continue;
  }
  await sleep(250);
  const f = await evalJs(`({ albums: window.__artistRiver.albums(), years: window.__artistRiver.years(), nos: window.__artistRiver.trackNos(), scroll: window.__artistRiver.scroll(), n: window.__artistRiver.titles().length })`);
  const albumCount = new Set(f.albums).size;
  if (albumCount > worst.albums) worst = { artist: name, albums: albumCount };
  let contiguous = true;
  for (let i = 1; i < f.albums.length; i++) {
    if (f.albums[i] !== f.albums[i - 1] && f.albums.slice(0, i).includes(f.albums[i])) contiguous = false;
  }
  let down = true;
  for (let i = 1; i < f.albums.length; i++) {
    if (f.albums[i] !== f.albums[i - 1] && (f.years[i] ?? -1) > (f.years[i - 1] ?? -1)) down = false;
  }
  let ascending = true;
  for (let i = 1; i < f.albums.length; i++) {
    if (f.albums[i] === f.albums[i - 1] && (f.nos[i] ?? 0) < (f.nos[i - 1] ?? 0)) ascending = false;
  }
  if (!contiguous || !down || !ascending || f.scroll !== 0) {
    failures.push(`feed order wrong for "${name}" (contiguous ${contiguous}, newest-first ${down}, track-order ${ascending}, scroll ${f.scroll})`);
  }
  await evalJs(`window.__artistRiver.close()`);
  await sleep(150);
}
console.log(`feed order across all ${artistNames.length} artists: verified (largest discography: "${worst.artist}" with ${worst.albums} albums)`);

await evalJs(`window.__artistRiver.open(${JSON.stringify(opened.artist)})`);
await sleep(600);
await evalJs(`document.querySelector('#mode-tabs button[data-mode="songs"]')?.click()`);
await sleep(700);
const tabSwitch = await evalJs(`window.__artistRiver.isOpen()`);
console.log(`tab switch closes the river: ${!tabSwitch}`);
if (tabSwitch) failures.push('artist river stayed open across a tab switch');
await evalJs(`document.querySelector('#mode-tabs button[data-mode="shelf"]')?.click()`);
await sleep(700);

ws.close();
if (failures.length > 0) {
  console.log('FAIL:', failures.join(' | '));
  process.exit(1);
}
console.log('ARTIST RIVER VERIFIED');
