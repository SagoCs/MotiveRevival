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
await sleep(180);
const beatOne = await evalJs(`(() => {
  const id = window.__shelf.selected();
  const card = document.querySelector('.shelf-card[data-id="' + id + '"]');
  const root = document.querySelector('#artist-river');
  const floor = document.querySelector('#artist-river-floor');
  const ruler = document.querySelector('#shelf-ruler');
  return {
    chosenOpacity: card === null ? null : parseFloat(card.style.opacity || '1'),
    riverOpacity: root === null ? null : parseFloat(getComputedStyle(root).opacity),
    floorOn: floor !== null && floor.classList.contains('on'),
    rulerOpacity: ruler === null ? null : parseFloat(getComputedStyle(ruler).opacity),
    veil: document.querySelector('#artist-river-veil') !== null,
  };
})()`);
console.log(`beat one: chosen ${beatOne.chosenOpacity === null ? 'n/a' : beatOne.chosenOpacity.toFixed(2)}, river ${beatOne.riverOpacity === null ? 'n/a' : beatOne.riverOpacity.toFixed(3)}, floor=${beatOne.floorOn}, ruler ${beatOne.rulerOpacity === null ? 'n/a' : beatOne.rulerOpacity.toFixed(2)}, veil=${beatOne.veil}`);
if (beatOne.chosenOpacity === null || !(beatOne.chosenOpacity < 0.9)) failures.push('chosen square did not dissolve with the slide');
if (beatOne.rulerOpacity === null || beatOne.rulerOpacity > 0.9) failures.push('instruments did not fade with the dissolve');
if (beatOne.floorOn) failures.push('floor rose before the square was gone');
if (beatOne.veil) failures.push('veil still exists after the parting redesign');
await sleep(440);
const beatTwo = await evalJs(`(() => {
  const id = window.__shelf.selected();
  const card = document.querySelector('.shelf-card[data-id="' + id + '"]');
  const root = document.querySelector('#artist-river');
  const floor = document.querySelector('#artist-river-floor');
  const ruler = document.querySelector('#shelf-ruler');
  return {
    chosenOpacity: card === null ? null : parseFloat(card.style.opacity || '1'),
    riverOpacity: root === null ? null : parseFloat(getComputedStyle(root).opacity),
    floorOn: floor !== null && floor.classList.contains('on'),
    rulerOpacity: ruler === null ? null : parseFloat(getComputedStyle(ruler).opacity),
  };
})()`);
console.log(`beat two: chosen ${beatTwo.chosenOpacity === null ? 'n/a' : beatTwo.chosenOpacity.toFixed(2)}, river ${beatTwo.riverOpacity === null ? 'n/a' : beatTwo.riverOpacity.toFixed(2)}, floor=${beatTwo.floorOn}, ruler ${beatTwo.rulerOpacity === null ? 'n/a' : beatTwo.rulerOpacity.toFixed(2)}`);
if (beatTwo.chosenOpacity === null || beatTwo.chosenOpacity > 0.05) failures.push('chosen square did not finish dissolving');
if (beatTwo.riverOpacity === null || beatTwo.riverOpacity < 0.99) failures.push('river did not finish rising');
if (!beatTwo.floorOn) failures.push('floor did not seal the world');
if (beatTwo.rulerOpacity === null || beatTwo.rulerOpacity > 0.05) failures.push('instruments still visible at rest');
await sleep(900);

const opened = await evalJs(`(() => {
  const root = document.querySelector('#artist-river');
  const floor = document.querySelector('#artist-river-floor');
  const ruler = document.querySelector('#shelf-ruler');
  return {
    open: window.__artistRiver.isOpen(),
    dom: root !== null && root.classList.contains('on'),
    riverOpacity: root === null ? null : parseFloat(getComputedStyle(root).opacity),
    floorOn: floor !== null && floor.classList.contains('on') && getComputedStyle(floor).visibility === 'visible',
    rulerOpacity: ruler === null ? null : parseFloat(getComputedStyle(ruler).opacity),
    shelfHidden: !window.__shelf.visible(),
    artist: window.__artistRiver.artist(),
  };
})()`);
console.log(`open: river=${opened.open} dom=${opened.dom} opacity=${opened.riverOpacity === null ? 'n/a' : opened.riverOpacity.toFixed(2)} floor=${opened.floorOn} ruler=${opened.rulerOpacity === null ? 'n/a' : opened.rulerOpacity.toFixed(2)} shelfHidden=${opened.shelfHidden} artist="${opened.artist}"`);
if (!opened.open || !opened.dom) failures.push('artist river did not open from center-click');
if (opened.riverOpacity === null || Math.abs(opened.riverOpacity - 1) > 0.01) failures.push(`river did not finish fading in (opacity ${opened.riverOpacity})`);
if (!opened.floorOn) failures.push('void floor missing at rest');
if (opened.rulerOpacity === null || opened.rulerOpacity > 0.05) failures.push('instruments still visible at rest');
if (!opened.shelfHidden) failures.push('shelf did not hide under the artist river');

const feed = await evalJs(`(() => {
  const snap = window.__songActions.queueSnapshot();
  const playingId = snap.ids[snap.index] ?? null;
  const ids = window.__artistRiver.ids();
  const playingIdx = playingId !== null ? ids.indexOf(playingId) : -1;
  const n = ids.length;
  return { albums: window.__artistRiver.albums(), years: window.__artistRiver.years(), nos: window.__artistRiver.trackNos(), scroll: window.__artistRiver.scroll(), n, playingIdx, expectedScroll: playingIdx >= 0 ? ((playingIdx % n) + n) % n : 0 };
})()`);
console.log(`feed: ${feed.n} songs, ${new Set(feed.albums).size} albums, scroll ${feed.scroll} (playing at ${feed.playingIdx})`);
if (feed.n === 0) failures.push('feed is empty');
if (feed.n >= 14 && feed.scroll !== feed.expectedScroll) failures.push(`river did not open on its home position (scroll ${feed.scroll}, expected ${feed.expectedScroll})`);
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

const replayOverlay = await evalJs(`document.querySelector('#overlay') !== null && !document.querySelector('#overlay').hidden`);
if (replayOverlay) {
  console.log('replay path: the clicked song was already playing - now-playing opened, closing it');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(600);
}

const homeIdx = await evalJs(`window.__artistRiver.ids().indexOf(${JSON.stringify(clickCardId)})`);
await evalJs(`document.querySelector('#artist-river .rv2-void')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));`);
await sleep(1700);
const homeState = await evalJs(`(() => { const ids = window.__artistRiver.ids(); return { scroll: window.__artistRiver.scroll(), n: ids.length, target: window.__artistRiver.toDisplay(ids.indexOf(${JSON.stringify(clickCardId)})) }; })()`);
const scrollAfterHome = homeState.scroll;
const n = homeState.n;
const circular = Math.abs((((scrollAfterHome - homeState.target) % n) + n) % n);
const homeOk = Math.min(circular, n - circular) < 0.06;
console.log(`dblclick home: scroll ${scrollAfterHome.toFixed(2)} vs playing display index ${homeState.target} (circular ${circular.toFixed(3)} of ${n})`);
if (!homeOk) failures.push(`double-click did not center the playing song (scroll ${scrollAfterHome.toFixed(2)}, index ${homeIdx})`);

await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
await sleep(900);
const neighborId = await evalJs(`window.__artistRiver.centerId()`);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await sleep(900);
const afterEnter = await evalJs(`(() => { const snap = window.__songActions.queueSnapshot(); return { current: snap.ids[snap.index] ?? null, upcoming: snap.upcoming.length }; })()`);
console.log(`enter plays the centered song: current=${afterEnter.current === neighborId ? 'centered song' : afterEnter.current}`);
if (afterEnter.current !== neighborId) failures.push('enter did not play the centered song');
if (afterEnter.upcoming > expectedUpcoming) failures.push(`enter assigned a queue (upcoming ${afterEnter.upcoming} > ${expectedUpcoming})`);
if (afterClick.upcoming !== expectedUpcoming) failures.push(`enter assigned a queue (${expectedUpcoming} -> ${afterEnter.upcoming ?? '?'})`);
const overlayAfterEnter = await evalJs(`document.querySelector('#overlay') ? !document.querySelector('#overlay').hidden : false`);
if (overlayAfterEnter) {
  console.log('replay on enter: now-playing opened over the river, closing it');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(800);
}

await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await sleep(1500);
const afterEsc = await evalJs(`(() => {
  const names = window.__shelf.names();
  const centerId = window.__shelf.entries()[window.__shelf.center()].id;
  const backCard = document.querySelector('.shelf-card[data-id="' + centerId + '"]');
  const floor = document.querySelector('#artist-river-floor');
  const ruler = document.querySelector('#shelf-ruler');
  return { open: window.__artistRiver.isOpen(), shelfVisible: window.__shelf.visible(), centerName: names[window.__shelf.center()], leftArtist: ${JSON.stringify(opened.artist)}, closeCalls: window.__artistRiver.closeCalls(), closing: window.__artistRiver.closing(), floorOn: floor !== null && floor.classList.contains('on'), backOpacity: backCard === null ? null : parseFloat(backCard.style.opacity || '1'), rulerOpacity: ruler === null ? null : parseFloat(getComputedStyle(ruler).opacity) };
})()`);
console.log(`escape: closed=${!afterEsc.open}, shelf=${afterEsc.shelfVisible}, center="${afterEsc.centerName}" (came from "${afterEsc.leftArtist}") closeCalls=${afterEsc.closeCalls} closing=${afterEsc.closing} floor=${afterEsc.floorOn} squareOpacity=${afterEsc.backOpacity === null ? 'n/a' : afterEsc.backOpacity.toFixed(2)} ruler=${afterEsc.rulerOpacity === null ? 'n/a' : afterEsc.rulerOpacity.toFixed(2)}`);
if (afterEsc.open) failures.push('escape did not close the artist river');
if (!afterEsc.shelfVisible) failures.push('shelf did not return after escape');
if (afterEsc.centerName !== afterEsc.leftArtist) failures.push(`shelf did not re-center on the artist just left (center ${afterEsc.centerName})`);
if (afterEsc.floorOn) failures.push('void floor did not clear after escape');
if (afterEsc.backOpacity === null || Math.abs(afterEsc.backOpacity - 1) > 0.01) failures.push('artist square did not fade back in');
if (afterEsc.rulerOpacity === null || afterEsc.rulerOpacity < 0.95) failures.push('instruments did not return after escape');

const artistNames = await evalJs('window.__shelf.names()');
let worst = { artist: null, albums: 0 };
for (const name of artistNames) {
  const ok = await evalJs(`window.__artistRiver.open(${JSON.stringify(name)})`);
  if (!ok) {
    failures.push(`feed empty for artist "${name}"`);
    continue;
  }
  await sleep(250);
  const f = await evalJs(`(() => {
    const snap = window.__songActions.queueSnapshot();
    const playingId = snap.ids[snap.index] ?? null;
    const ids = window.__artistRiver.ids();
    const playingIdx = playingId !== null ? ids.indexOf(playingId) : -1;
    const n = ids.length;
    return { albums: window.__artistRiver.albums(), years: window.__artistRiver.years(), nos: window.__artistRiver.trackNos(), scroll: window.__artistRiver.scroll(), n, expected: playingIdx >= 0 ? ((playingIdx % n) + n) % n : 0 };
  })()`);
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
  if (!contiguous || !down || !ascending) {
    failures.push(`feed order wrong for "${name}" (contiguous ${contiguous}, newest-first ${down}, track-order ${ascending})`);
  }
  if (f.n >= 14 && f.scroll !== f.expected) {
    failures.push(`river did not open centered on the playing song for "${name}" (scroll ${f.scroll}, expected ${f.expected})`);
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

await evalJs(`document.querySelector('#mode-tabs button[data-mode="shelf"]')?.click()`);
await sleep(700);

const artistNames2 = await evalJs('window.__shelf.names()');
const dimArtist = artistNames2.includes('Mili') ? 'Mili' : artistNames2[0];
await evalJs(`window.__artistRiver.open(${JSON.stringify(dimArtist)})`);
await sleep(500);
const dimAlbums = await evalJs(`window.__artistRiver.albums()`);
const dimTarget = dimAlbums[1] ?? dimAlbums[0];
const dimFirst = dimAlbums.indexOf(dimTarget);
await evalJs(`window.__artistRiver.close()`);
await sleep(500);
await evalJs(`window.__artistRiver.openDim(${JSON.stringify(dimArtist)}, ${JSON.stringify(dimTarget)})`);
await sleep(700);
const dimState = await evalJs(`(() => {
  const snap = window.__songActions.queueSnapshot();
  void 0;
  return {
    album: window.__artistRiver.dimAlbum(),
    scroll: window.__artistRiver.scroll(),
    n: window.__artistRiver.titles().length,
    albums: window.__artistRiver.albums(),
    ghosts: [...document.querySelectorAll('#artist-river .rv2-card')].filter((el) => parseFloat(el.style.opacity ?? '1') < 0.2).length,
  };
})()`);
let spanSize = 0;
for (const a of dimState.albums) {
  if (a === dimTarget) spanSize += 1;
}
console.log(`dim: album="${dimState.album}" (span ${spanSize}), scroll ${dimState.scroll} (first at ${dimFirst}), ghosts ${dimState.ghosts}/${dimState.n}`);
if (dimState.album !== dimTarget) failures.push('dim album not set');
if (dimState.scroll !== dimFirst) failures.push(`dim did not land on the album's first song (${dimState.scroll} vs ${dimFirst})`);
if (dimState.n - spanSize > 0 && dimState.ghosts < Math.min(8, dimState.n - spanSize)) failures.push(`ghosts not visible (${dimState.ghosts} dimmed of ${dimState.n - spanSize} expected)`);

const cx2 = Math.round((await evalJs('innerWidth')) * 0.5);
const cy2 = Math.round(52 + ((await evalJs('innerHeight')) - 52 - 62) / 2);
const ghostTarget = await evalJs(`(() => {
  for (const el of document.querySelectorAll('#artist-river .rv2-card')) {
    if (parseFloat(el.style.opacity ?? '1') >= 0.2) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 60 && r.top > 120 && r.bottom < innerHeight - 80) return { id: el.dataset.id, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }
  return null;
})()`);
const currentBeforeGhost = await evalJs(`window.__songActions.queueSnapshot().ids[window.__songActions.queueSnapshot().index]`);
if (ghostTarget !== null) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ghostTarget.x, y: ghostTarget.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ghostTarget.x, y: ghostTarget.y, button: 'left', clickCount: 1 });
  await sleep(700);
  const currentAfterGhost = await evalJs(`window.__songActions.queueSnapshot().ids[window.__songActions.queueSnapshot().index]`);
  console.log(`ghost inert: current unchanged=${currentBeforeGhost === currentAfterGhost}`);
  if (currentBeforeGhost !== currentAfterGhost) failures.push('ghost card answered a click under the dim');
} else {
  console.log('ghost inert: no on-screen ghost to probe');
}

await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await sleep(500);
const afterDimEsc = await evalJs(`({ dim: window.__artistRiver.dimAlbum(), open: window.__artistRiver.isOpen() })`);
console.log(`esc removes dim: dim=${JSON.stringify(afterDimEsc.dim)}, river open=${afterDimEsc.open}`);
if (afterDimEsc.dim !== null || !afterDimEsc.open) failures.push('first escape did not remove the dim while keeping the river');

await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
await sleep(900);
const afterDown = await evalJs(`window.__artistRiver.scroll()`);
console.log(`arrow down: scroll ${afterDown.toFixed(2)} (was ${dimState.scroll})`);
if (Math.abs(afterDown - (dimState.scroll + 1)) > 0.01) failures.push(`arrow down did not step one song (${dimState.scroll} -> ${afterDown})`);

await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await sleep(1600);

const gestArtist = artistNames2[0];
await evalJs(`window.__artistRiver.open(${JSON.stringify(gestArtist)})`);
await sleep(500);
const gestClick = await evalJs(`(() => {
  const cards = [...document.querySelectorAll('#artist-river .rv2-card')];
  let best = null;
  for (const el of cards) {
    const r = el.getBoundingClientRect();
    const d = Math.abs(r.top + r.height / 2 - innerHeight / 2);
    if (best === null || d < best.d) best = { d, id: el.dataset.id, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }
  return best;
})()`);
if (gestClick !== null) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: gestClick.x, y: gestClick.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: gestClick.x, y: gestClick.y, button: 'left', clickCount: 1 });
  await sleep(900);
}
await evalJs(`window.__artistRiver.close()`);
await sleep(800);
const gestIdx = await evalJs(`window.__shelf.names().indexOf(${JSON.stringify(gestArtist)})`);
const voidX = Math.round((await evalJs('innerWidth')) * 0.04);
const voidY = (await evalJs('innerHeight')) - 100;
const voidCheck = await evalJs(`(() => { const el = document.elementFromPoint(${voidX}, ${voidY}); return el ? (el.className || el.id) : 'none'; })()`);
console.log(`gesture tap point (${voidX},${voidY}) hits: ${voidCheck}`);
const tap = async () => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: voidX, y: voidY, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: voidX, y: voidY, button: 'left', clickCount: 1 });
  await sleep(110);
};
await tap();
await tap();
await sleep(1900);
const afterDouble = await evalJs(`({ center: window.__shelf.names()[window.__shelf.center()], idx: window.__shelf.center() })`);
console.log(`double-tap: shelf center "${afterDouble.center}" (playing artist "${gestArtist}" at ${gestIdx})`);
if (afterDouble.center !== gestArtist) failures.push(`double-tap did not glide to the playing artist (center ${afterDouble.center})`);

await tap();
await sleep(100);
await tap();
await sleep(100);
await tap();
await sleep(2400);
const afterTriple = await evalJs(`(() => {
  const snap = window.__songActions.queueSnapshot();
  const playingId = snap.ids[snap.index] ?? null;
  const ids = window.__artistRiver.ids();
  const playingIdx = ids.indexOf(playingId);
  const n = Math.max(1, ids.length);
  const pos = ((window.__artistRiver.scroll() % n) + n) % n;
  const expected = window.__artistRiver.toDisplay(playingIdx >= 0 ? playingIdx : 0);
  const exp = ((expected % n) + n) % n;
  return { open: window.__artistRiver.isOpen(), playingIdx, pos, expected: exp, match: Math.abs(pos - exp) < 0.06, debug: window.__gestDebug ?? '' };
})()`);
console.log(`triple-tap: open=${afterTriple.open}, playing index ${afterTriple.playingIdx}, scroll ${afterTriple.pos.toFixed(2)} (display ${afterTriple.expected}), trace "${afterTriple.debug}"`);
if (!afterTriple.open) failures.push('triple-tap did not enter the artist river');
if (!afterTriple.match) failures.push(`triple-tap river not centered on the playing song (pos ${afterTriple.pos.toFixed(2)} vs ${afterTriple.expected})`);
await evalJs(`window.__artistRiver.close()`);
await sleep(600);

const smallArtist = await evalJs(`(() => {
  const lib = window.__songActions.libraryTracks();
  const counts = new Map();
  for (const t of lib) {
    const name = t.primaryArtist ?? t.artist ?? '';
    if (name.trim() === '') continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  for (const [name, n] of counts) {
    if (n >= 3 && n <= 5) return { name, n };
  }
  return null;
})()`);
if (smallArtist === null) {
  console.log('small artist: none with 3-5 songs, pin check skipped');
} else {
  await evalJs(`window.__artistRiver.open(${JSON.stringify(smallArtist.name)})`);
  await sleep(1800);
  const pinnedState = await evalJs(`(() => {
    const cards = [...document.querySelectorAll('#artist-river .rv2-card')].map((el) => Math.round(el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2));
    return { open: window.__artistRiver.isOpen(), n: window.__artistRiver.ids().length, center: window.__artistRiver.centerId(), newest: window.__artistRiver.ids()[0], cards };
  })()`);
  console.log(`small artist: ${pinnedState.n} songs, center ${pinnedState.center}, newest ${pinnedState.newest}`);
  if (!pinnedState.open || pinnedState.n !== smallArtist.n || pinnedState.cards.length !== smallArtist.n) failures.push('small artist did not pin as a static field');
  if (pinnedState.center !== pinnedState.newest) failures.push('small artist: the newest song does not hold the glow');
  const vpA = await evalJs(`({ w: window.innerWidth, h: window.innerHeight })`);
  for (let i = 0; i < 3; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(vpA.w / 2), y: Math.round(vpA.h / 2), deltaX: 0, deltaY: -400 });
    await sleep(80);
  }
  await sleep(1500);
  const afterWheelArtist = await evalJs(`(() => [...document.querySelectorAll('#artist-river .rv2-card')].map((el) => Math.round(el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2)))()`);
  if (JSON.stringify(afterWheelArtist) !== JSON.stringify(pinnedState.cards)) failures.push('small artist field scrolled while pinned');
  await evalJs(`window.__artistRiver.close()`);
  await sleep(1200);
}

ws.close();
if (failures.length > 0) {
  console.log('FAIL:', failures.join(' | '));
  process.exit(1);
}
console.log('ARTIST RIVER VERIFIED');
