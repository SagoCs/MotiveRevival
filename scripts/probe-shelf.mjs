import zlib from 'node:zlib';

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
const accPlaying = await evalJs(`getComputedStyle(document.documentElement).getPropertyValue('--acc-a').trim()`);
await evalJs(`document.querySelector('#mode-tabs button[data-mode="shelf"]')?.click()`);
await sleep(1400);
await evalJs(`window.__shelf.goto(Math.floor(window.__shelf.names().length / 2))`);
await sleep(900);

const hook = await evalJs(`window.__shelf ? {
  visible: window.__shelf.visible(),
  lens: window.__shelf.lens(),
  names: window.__shelf.names(),
  center: window.__shelf.center(),
  scroll: window.__shelf.scroll(),
  selected: window.__shelf.selected(),
  viewW: innerWidth,
  viewH: innerHeight,
} : null`);
console.log('shelf visible:', hook?.visible, 'lens:', hook?.lens, 'entries:', hook?.names?.length);
if (hook === null || hook.visible !== true) failures.push('shelf not visible after tab click');
if (hook !== null && hook.lens !== 'artists') failures.push('wrong lens at boot');

const names = hook?.names ?? [];
const bucketOf = (n) => {
  const c = n.charAt(0).toUpperCase().charCodeAt(0);
  return c >= 65 && c <= 90 ? 0 : 1;
};
const byNameCmp = (a, b) => {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  return la === lb ? (a < b ? -1 : a > b ? 1 : 0) : la < lb ? -1 : 1;
};
let ordered = true;
for (let i = 1; i < names.length; i++) {
  if (bucketOf(names[i - 1]) !== bucketOf(names[i])) continue;
  if (byNameCmp(names[i - 1], names[i]) > 0) ordered = false;
}
console.log(`A-Z + # order: ${ordered ? 'yes' : 'NO'} (${names.length} entries)`);
if (!ordered) failures.push('entries not A-Z ordered with # last');

const states = await evalJs('window.__shelf.cards()');
const visible = states.filter((s) => s.visible && s.scale > 0);
console.log(`visible cards: ${visible.length}`);
if (visible.length < 2) failures.push(`too few visible cards (${visible.length})`);
const centerOf = (s) => Math.abs(s.x - hook.viewW / 2);
const centerCard = visible.reduce((best, s) => (centerOf(s) < centerOf(best) ? s : best), visible[0]);
const edgeCard = visible.reduce((best, s) => (centerOf(s) > centerOf(best) ? s : best), visible[0]);
console.log(`center emphasis: center scale ${centerCard.scale.toFixed(3)} vs edge ${edgeCard.scale.toFixed(3)}`);
if (!(centerCard.scale > edgeCard.scale)) failures.push('no center emphasis (scale)');
console.log(`gentle tilt: |center| ${Math.abs(centerCard.tilt).toFixed(1)} deg, |edge| ${Math.abs(edgeCard.tilt).toFixed(1)} deg (expect edge <= 22)`);
if (Math.abs(edgeCard.tilt) > 22) failures.push(`tilt too strong (${edgeCard.tilt.toFixed(1)} deg)`);

const scale = (await capture()).width / hook.viewW;
const img = await capture();
const bandTop = Math.round((52 + 120) * scale);
const bandBottom = Math.round((hook.viewH - 62 - 220) * scale);
const edgeW = Math.round(hook.viewW * 0.05 * scale);
const midW = Math.round(hook.viewW * 0.2 * scale);
let edgeMax = 0;
let midMax = 0;
for (let y = bandTop; y < bandBottom; y += 3) {
  for (let x = 0; x < edgeW; x += 2) if (img.lum(x, y) > edgeMax) edgeMax = img.lum(x, y);
  for (let x = Math.round(img.width / 2 - midW / 2); x < Math.round(img.width / 2 + midW / 2); x += 2) if (img.lum(x, y) > midMax) midMax = img.lum(x, y);
}
console.log(`edge dissolve: edge max lum ${edgeMax.toFixed(1)} vs center max ${midMax.toFixed(1)} (expect edge <= 70, center >= 60)`);
if (edgeMax > 70) failures.push(`edge not dissolved (max ${edgeMax.toFixed(1)})`);
if (midMax < 60) failures.push(`center faces not bright (${midMax.toFixed(1)})`);

async function capture() {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  return decodePng(Buffer.from(shot.data, 'base64'), zlib.inflateSync);
}

function decodePng(png, inflate) {
  let pos = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (pos < png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.toString('ascii', pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = inflate(Buffer.concat(idat));
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
        const a = left;
        const b = up;
        const c = ul;
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        val = cur + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      px[y * stride + i] = val & 0xff;
    }
    rp += stride;
  }
  return {
    width,
    height,
    lum(x, y) {
      const i = (y * width + x) * 3;
      return 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    },
  };
}

const sideCandidates = visible.filter((s) => s.id !== centerCard.id && s.scale > 0.55 && s.scale < 0.95);
const sideCard = (sideCandidates.length > 0 ? sideCandidates : visible.filter((s) => s.id !== centerCard.id)).reduce((best, s) => (centerOf(s) > centerOf(best) ? s : best), centerCard);
const sideRect = await evalJs(`(() => { const r = window.__shelf.rect(${JSON.stringify(sideCard.id)}); return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; })()`);
console.log(`side card rect: ${JSON.stringify(sideRect)}`);
const sideOk = sideRect !== null && sideRect.x >= 0 && sideRect.x + sideRect.w <= hook.viewW && sideRect.y >= 0;
if (sideRect === null || !sideOk) failures.push('side card rect off viewport');
const accBefore = await evalJs(`getComputedStyle(document.documentElement).getPropertyValue('--acc-a').trim()`);
if (sideOk) {
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: Math.round(sideRect.x + sideRect.w / 2), y: Math.round(sideRect.y + sideRect.h / 2), button: 'left', clickCount: 1,
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: Math.round(sideRect.x + sideRect.w / 2), y: Math.round(sideRect.y + sideRect.h / 2), button: 'left', clickCount: 1,
  });
}
const colorRace = evalJs(`(async () => {
  const t0 = performance.now();
  while (performance.now() - t0 < 4000) {
    if (window.__shelf.selected() !== null) break;
    await new Promise((r) => setTimeout(r, 40));
  }
  const ledger = document.querySelector('.shelf-card.selected .shelf-ledger');
  if (ledger === null) return null;
  const early = getComputedStyle(ledger).color;
  await new Promise((r) => setTimeout(r, 1500));
  const late = getComputedStyle(ledger).color;
  return { early, late };
})()`, true);
await sleep(1900);
const afterClick = await evalJs(`({ selected: window.__shelf.selected(), centerName: window.__shelf.names()[window.__shelf.center()] })`);
console.log(`selection: selected=${afterClick.selected !== null}, center now "${afterClick.centerName}"`);
if (afterClick.selected === null) failures.push('tap did not select');
if (afterClick.selected !== null) {
  const selectedName = afterClick.selected.startsWith('artist:') ? afterClick.selected.slice(7) : afterClick.selected.slice(9);
  console.log(`glide check: center="${afterClick.centerName}" selected="${selectedName}"`);
  if (afterClick.centerName !== selectedName) failures.push('selection did not glide to center');
}
const accAfter = await evalJs(`getComputedStyle(document.documentElement).getPropertyValue('--acc-a').trim()`);
console.log(`selection tone: --acc-a ${accBefore} -> ${accAfter}`);
if (accBefore === accAfter) failures.push('selection did not push tone');
const race = await colorRace;
console.log(`ledger color: at reveal ${race ? race.early : 'n/a'} -> after crossfade ${race ? race.late : 'n/a'}`);
if (race === null) failures.push('ledger color race check missing');
else if (race.early !== race.late) failures.push(`ledger revealed in the wrong tone (${race.early} became ${race.late})`);

const selRect = await evalJs(`(() => {
  const id = window.__shelf.selected();
  const r = id !== null ? window.__shelf.rect(id) : null;
  return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
})()`);
if (selRect === null) failures.push('focused card rect missing after settle');
else {
  const imgSel = await capture();
  const band = 14;
  const gx = Math.max(0, Math.round((selRect.x - band) * scale));
  const gx2 = Math.min(imgSel.width - 1, Math.round((selRect.x + selRect.w + band) * scale));
  const gy = Math.max(0, Math.round((selRect.y - band) * scale));
  const gy2 = Math.min(imgSel.height - 1, Math.round((selRect.y + selRect.h + band) * scale));
  const ix0 = Math.round(selRect.x * scale);
  const ix1 = Math.round((selRect.x + selRect.w) * scale);
  const iy0 = Math.round(selRect.y * scale);
  const iy1 = Math.round((selRect.y + selRect.h) * scale);
  let glowMax = 0;
  for (let y = gy; y <= gy2; y += 2) {
    for (let x = gx; x <= gx2; x += 2) {
      if (x > ix0 - 4 * scale && x < ix1 + 4 * scale && y > iy0 - 4 * scale && y < iy1 + 4 * scale) continue;
      if (imgSel.lum(x, y) > glowMax) glowMax = imgSel.lum(x, y);
    }
  }
  console.log(`focus bloom visible: glow band max lum ${glowMax.toFixed(1)} outside focused card (expect >= 35)`);
  if (glowMax < 35) failures.push(`focus bloom not visible outside the card (${glowMax.toFixed(1)})`);
}

await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await sleep(500);
const afterEsc = await evalJs(`({ selected: window.__shelf.selected(), acc: getComputedStyle(document.documentElement).getPropertyValue('--acc-a').trim() })`);
console.log(`escape keeps center-focus: selected=${afterEsc.selected}`);
if (afterEsc.selected === null) failures.push('escape cleared the center focus (center-focus grammar)');

const centerBefore = await evalJs(`window.__shelf.center()`);
const shelfCount = (await evalJs('window.__shelf.names()')).length;
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
await sleep(1500);
const centerAfter = await evalJs(`window.__shelf.center()`);
const expectedCenter = (centerBefore + 1) % shelfCount;
console.log(`arrow right: center ${centerBefore} -> ${centerAfter} (expected ${expectedCenter} of ${shelfCount})`);
if (centerAfter !== expectedCenter) failures.push(`arrow right did not step one artist (${centerBefore} -> ${centerAfter})`);

await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await sleep(1600);
const enterState = await evalJs(`({ open: window.__artistRiver.isOpen(), artist: window.__artistRiver.artist(), expected: window.__shelf.names()[${expectedCenter}] })`);
console.log(`enter opens the centered artist: river=${enterState.open}, artist="${enterState.artist}" (expected "${enterState.expected}")`);
if (!enterState.open) failures.push('enter did not open the artist river');
if (enterState.artist !== enterState.expected) failures.push(`enter opened the wrong artist (${enterState.artist} vs ${enterState.expected})`);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await sleep(1700);

const samplerPromise = evalJs(`(async () => {
  const frames = [];
  const t0 = performance.now();
  const fixed = window.__shelf.cards().find((c) => c.visible && c.scale > 0.7);
  if (fixed === undefined) return [];
  await new Promise((done) => {
    const loop = () => {
      const r = window.__shelf.rect(fixed.id);
      frames.push({ x: r ? r.x + r.width / 2 : null, s: window.__shelf.scroll() });
      if (performance.now() - t0 < 1500) requestAnimationFrame(loop);
      else done(null);
    };
    requestAnimationFrame(loop);
  });
  return frames.filter((f) => f.x !== null);
})()`, true);
await sleep(250);
const shelfCenterX = Math.round(hook.viewW / 2);
const shelfCenterY = Math.round(52 + (hook.viewH - 52 - 62) / 2);
for (let i = 0; i < 4; i++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: shelfCenterX, y: shelfCenterY, deltaX: 0, deltaY: 260 });
  await sleep(90);
}
await sleep(1500);
const sampler = await samplerPromise;
console.log(`motion sampling: ${sampler.length} frames captured`);
let continuityOk = sampler.length > 20;
for (let i = 1; i < sampler.length; i++) {
  const dx = Math.abs(sampler[i].x - sampler[i - 1].x);
  const ds = Math.abs(sampler[i].s - sampler[i - 1].s) * (hook.viewW / 7);
  if (dx > ds * 1.25 + 3) continuityOk = false;
}
console.log(`motion continuity: ${continuityOk ? 'within travel bound' : 'VIOLATED'}`);
if (!continuityOk) failures.push('motion continuity violated (card moved further than scroll travel)');

const RULER = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
const rulerState = () => evalJs(`(() => {
  const bar = document.querySelector('#shelf-ruler');
  if (bar === null) return null;
  const keys = [...bar.querySelectorAll('.shelf-ruler-key')];
  const barRect = bar.getBoundingClientRect();
  const keyRects = keys.map((k) => k.getBoundingClientRect());
  return {
    keys: keys.length,
    order: keys.map((k) => k.dataset.letter).join(''),
    clearButtons: bar.querySelectorAll('.shelf-ruler-clear').length,
    dead: keys.filter((k) => k.classList.contains('dead')).map((k) => k.dataset.letter),
    lit: keys.filter((k) => k.classList.contains('lit')).map((k) => k.dataset.letter),
    barTop: barRect.top,
    barBottom: barRect.bottom,
    lensTop: document.querySelector('#shelf-lens').getBoundingClientRect().top,
    dimmed: document.querySelectorAll('.shelf-card.dimmed').length,
    minKeyW: Math.min(...keyRects.map((r) => r.width)),
    minKeyH: Math.min(...keyRects.map((r) => r.height)),
    stripCx: (keyRects[0].left + keyRects[keyRects.length - 1].right) / 2,
    fontSize: getComputedStyle(keys[0]).fontSize,
    fontW: getComputedStyle(keys[0]).fontWeight,
    capW: (() => { const el = document.querySelector('.shelf-card .shelf-name'); return el === null ? null : getComputedStyle(el).fontWeight; })(),
    lensW: getComputedStyle(document.querySelector('#shelf-lens button')).fontWeight,
  };
})()`);
const clickKey = (letter) => evalJs(`document.querySelector('#shelf-ruler button[data-letter="${letter}"]')?.click()`);
const expectedDead = (letters) => RULER.filter((l) => !new Set(letters).has(l));

const entries = await evalJs('window.__shelf.letters()');
let ruler = await rulerState();
console.log(`ruler: ${ruler.keys} keys, ${ruler.dead.length} sleeping, order ${ruler.order.slice(0, 4)}..., top=${Math.round(ruler.barTop)}, key ${ruler.minKeyW.toFixed(0)}x${ruler.minKeyH.toFixed(0)} @${ruler.fontSize}`);
if (ruler === null) failures.push('ruler missing');
else {
  if (ruler.keys !== 27) failures.push(`ruler key count ${ruler.keys} != 27`);
  if (ruler.order !== '#ABCDEFGHIJKLMNOPQRSTUVWXYZ') failures.push(`ruler order wrong: ${ruler.order.slice(0, 5)}...`);
  if (ruler.clearButtons !== 0) failures.push('ruler clear button must not exist (Esc clears)');
  if (ruler.fontSize !== '14px') failures.push(`ruler font size ${ruler.fontSize} != 14px`);
  if (ruler.fontW !== '300' || ruler.capW !== '300' || ruler.lensW !== '300') failures.push(`shelf text weight not 300 (ruler ${ruler.fontW}, caption ${ruler.capW}, lens ${ruler.lensW})`);
  if (ruler.minKeyW < 23 || ruler.minKeyH < 24) failures.push(`ruler key targets too small (${ruler.minKeyW.toFixed(0)}x${ruler.minKeyH.toFixed(0)})`);
  if (Math.abs(ruler.stripCx - hook.viewW / 2) > 1.5) failures.push(`visible letter strip off center by ${(ruler.stripCx - hook.viewW / 2).toFixed(1)}px`);
  if (!(ruler.barTop >= 52 && ruler.barBottom <= 100)) failures.push(`ruler not seated under the bezel (top ${Math.round(ruler.barTop)})`);
  if (ruler.lensTop < ruler.barBottom - 2) failures.push('lens switcher not seated under the ruler');
  const wantDead = expectedDead(entries);
  if (JSON.stringify([...ruler.dead].sort()) !== JSON.stringify([...wantDead].sort())) failures.push(`sleeping letters wrong (${ruler.dead.length} vs ${wantDead.length} expected)`);
}

const litLetter = entries[0];
if (ruler !== null && ruler.dead.length > 0) {
  await clickKey(ruler.dead[0]);
  await sleep(400);
  const afterDead = await rulerState();
  if (afterDead.lit.length !== 0) failures.push(`sleeping letter ${ruler.dead[0]} was lightable`);
}
await clickKey(litLetter);
await sleep(1700);
ruler = await rulerState();
const afterLight = await evalJs(`({ lit: window.__shelf.lit(), centerLetter: window.__shelf.letters()[window.__shelf.center()], n: window.__shelf.names().length })`);
console.log(`light "${litLetter}": lit=${JSON.stringify(afterLight.lit)}, center letter=${afterLight.centerLetter}, dimmed=${ruler.dimmed}/${afterLight.n}`);
if (JSON.stringify(afterLight.lit) !== JSON.stringify([litLetter])) failures.push('letter did not light');
if (afterLight.centerLetter !== litLetter) failures.push(`shelf did not glide to the lit letter (center ${afterLight.centerLetter})`);
if (ruler.dimmed !== afterLight.n - 1) failures.push(`dim count wrong (${ruler.dimmed} of ${afterLight.n - 1} expected)`);
const dimOpacity = await evalJs(`(() => { const f = document.querySelector('.shelf-card.dimmed .shelf-face'); return f === null ? null : getComputedStyle(f).opacity; })()`);
console.log(`ghost face opacity: ${dimOpacity}`);
if (dimOpacity === null || Math.abs(parseFloat(dimOpacity) - 0.13) > 0.01) failures.push(`ghost dim opacity wrong (${dimOpacity})`);

const ghost = await evalJs(`(() => {
  const dimmed = [...document.querySelectorAll('.shelf-card.dimmed')];
  const mid = innerWidth / 2;
  for (const el of dimmed) {
    if (el.style.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width > 60 && r.left >= 0 && r.right <= innerWidth && Math.abs(r.left + r.width / 2 - mid) < innerWidth * 0.3) {
      const px = Math.round(r.left + r.width / 2);
      const py = Math.round(r.top + r.height / 2);
      const top = document.elementFromPoint(px, py)?.closest('.shelf-card');
      if (top !== null && top.dataset.id === el.dataset.id) {
        return { id: el.dataset.id, x: px, y: py };
      }
    }
  }
  return null;
})()`);
const beforeGhost = await evalJs(`({ center: window.__shelf.names()[window.__shelf.center()], selected: window.__shelf.selected() })`);
if (ghost !== null) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ghost.x, y: ghost.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ghost.x, y: ghost.y, button: 'left', clickCount: 1 });
  await sleep(1700);
  const afterGhost = await evalJs(`({ center: window.__shelf.names()[window.__shelf.center()], selected: window.__shelf.selected() })`);
  console.log(`ghost tap: center "${afterGhost.center}" vs "${beforeGhost.center}"`);
  if (afterGhost.center !== beforeGhost.center || afterGhost.selected !== beforeGhost.selected) failures.push('ghost card answered a tap (dimmed cards must be inert)');
} else {
  console.log('ghost tap: no on-screen ghost to probe');
}

const second = entries.find((l) => l !== litLetter);
await clickKey(second);
await sleep(1700);
const afterSecond = await evalJs(`({ lit: window.__shelf.lit(), centerLetter: window.__shelf.letters()[window.__shelf.center()] })`);
console.log(`multi "${second}": lit=${JSON.stringify(afterSecond.lit)}, center letter=${afterSecond.centerLetter}`);
if (JSON.stringify([...afterSecond.lit].sort()) !== JSON.stringify([litLetter, second].sort())) failures.push('multi-select union failed');
if (afterSecond.centerLetter !== second) failures.push('second letter did not glide to center');

const flingCenterX = Math.round(hook.viewW / 2);
const flingCenterY = Math.round(52 + (hook.viewH - 52 - 62) / 2);
for (let i = 0; i < 5; i++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: flingCenterX, y: flingCenterY, deltaX: 0, deltaY: -300 });
  await sleep(80);
}
await sleep(2200);
const afterFling = await evalJs(`({ centerLetter: window.__shelf.letters()[window.__shelf.center()], pos: window.__shelf.scroll() })`);
console.log(`snap-to-lit after fling: center letter=${afterFling.centerLetter}, pos=${afterFling.pos.toFixed(2)}`);
if (![litLetter, second].includes(afterFling.centerLetter)) failures.push(`settle landed on a ghost (${afterFling.centerLetter})`);

await clickKey(second);
await sleep(500);
const afterToggle = await evalJs('window.__shelf.lit()');
console.log(`toggle off "${second}": lit=${JSON.stringify(afterToggle)}`);
if (JSON.stringify(afterToggle) !== JSON.stringify([litLetter])) failures.push('lit letter did not toggle off');

await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await sleep(500);
const afterEscClear = await rulerState();
console.log(`escape clears: lit=${JSON.stringify(afterEscClear.lit)}, dimmed=${afterEscClear.dimmed}`);
if (afterEscClear.lit.length !== 0 || afterEscClear.dimmed !== 0) failures.push('escape did not clear the lit letters');

await evalJs(`document.querySelector('#shelf-lens button:nth-child(2)')?.click()`);
await sleep(900);
const lens2 = await evalJs(`({ lens: window.__shelf.lens(), names: window.__shelf.names(), letters: window.__shelf.letters(), lit: window.__shelf.lit() })`);
ruler = await rulerState();
console.log(`playlists lens: ${lens2.lens}, entries: ${lens2.names.length}, lit after switch=${JSON.stringify(lens2.lit)}`);
if (lens2.lens !== 'playlists') failures.push('lens switch failed');
if (lens2.lit.length !== 0) failures.push('lit letters did not clear on lens switch');
const plWantDead = expectedDead(lens2.letters);
if (JSON.stringify([...ruler.dead].sort()) !== JSON.stringify([...plWantDead].sort())) failures.push('playlists ruler sleeping letters wrong');
let plOrdered = true;
for (let i = 1; i < lens2.names.length; i++) {
  if (bucketOf(lens2.names[i - 1]) !== bucketOf(lens2.names[i])) continue;
  if (byNameCmp(lens2.names[i - 1], lens2.names[i]) > 0) plOrdered = false;
}
if (!plOrdered) failures.push('playlists not A-Z ordered with # last');

const scratchId = await evalJs(`(async () => {
  const A = window.__songActions;
  if (!A || A.libraryTracks().length === 0) return null;
  const prior = A.playlists().find((x) => x.name === '__probe_scratch');
  if (prior) await A.removePlaylist(prior.id);
  await A.createPlaylistWithTrack('__probe_scratch', A.libraryTracks()[0]);
  return A.playlists().find((x) => x.name === '__probe_scratch')?.id ?? null;
})()`, true);
await sleep(600);
const plScratch = await evalJs(`({ names: window.__shelf.names(), letters: window.__shelf.letters() })`);
ruler = await rulerState();
const plAwake = RULER.filter((l) => !ruler.dead.includes(l));
console.log(`scratch playlist: entries=${plScratch.names.length}, awake=${JSON.stringify(plAwake)}`);
if (scratchId === null) failures.push('scratch playlist not created (no library tracks?)');
else {
  const scratchIdx = plScratch.names.indexOf('__probe_scratch');
  if (scratchIdx < 0) failures.push(`scratch playlist missing from the playlists field (${plScratch.names.length} entries)`);
  else if (plScratch.letters[scratchIdx] !== '#') failures.push(`scratch playlist letter bucket wrong (${plScratch.letters[scratchIdx]})`);
  const plWantAwake = [...new Set(plScratch.letters)].sort();
  if (JSON.stringify([...plAwake].sort()) !== JSON.stringify(plWantAwake)) failures.push(`ruler wake set wrong (awake ${JSON.stringify([...plAwake].sort())}, field buckets ${JSON.stringify(plWantAwake)})`);
  if (!plAwake.includes('#')) failures.push(`ruler did not wake for the new playlist (${JSON.stringify(plAwake)})`);
  await clickKey('#');
  await sleep(900);
  const plLit = await evalJs(`({ lit: window.__shelf.lit(), centerLetter: window.__shelf.letters()[window.__shelf.center()] })`);
  console.log(`playlists ruler light #: lit=${JSON.stringify(plLit.lit)}, center letter=${plLit.centerLetter}`);
  if (JSON.stringify(plLit.lit) !== JSON.stringify(['#']) || plLit.centerLetter !== '#') failures.push('playlists ruler letter click failed');
  await clickKey('#');
  await sleep(300);
  const plUnlit = await evalJs('window.__shelf.lit()');
  if (plUnlit.length !== 0) failures.push('playlists ruler toggle-off failed');
  await evalJs(`window.__songActions.removePlaylist(${JSON.stringify(scratchId)})`);
  await sleep(600);
  const plGone = await evalJs('window.__shelf.names()');
  const lettersAfter = await evalJs('window.__shelf.letters()');
  ruler = await rulerState();
  console.log(`scratch removed: entries=${plGone.length}, sleeping=${ruler.dead.length}`);
  if (plGone.includes('__probe_scratch')) failures.push('scratch playlist not removed');
  const wantDeadAfter = expectedDead(lettersAfter);
  if (JSON.stringify([...ruler.dead].sort()) !== JSON.stringify([...wantDeadAfter].sort())) failures.push(`ruler did not re-sleep after playlist removal (dead ${ruler.dead.length}, expected ${wantDeadAfter.length})`);
}

await evalJs(`document.querySelector('#shelf-lens button:nth-child(1)')?.click()`);
await sleep(700);
const lens3 = await evalJs('window.__shelf.lens()');
if (lens3 !== 'artists') failures.push('lens switch back failed');


await evalJs(`document.querySelector('#mode-tabs button[data-mode="songs"]')?.click()`);
await sleep(900);
const left = await evalJs(`({
  visible: window.__shelf.visible(),
  acc: getComputedStyle(document.documentElement).getPropertyValue('--acc-a').trim(),
})`);
console.log(`tab leave: shelf visible=${left.visible}, tone restored to playing=${left.acc === accPlaying}`);
if (left.visible !== false) failures.push('shelf did not hide on tab leave');
if (left.acc !== accPlaying) failures.push('tab leave did not restore the playing tone');

await send('Page.reload');
await sleep(2500);
await evalJs(`document.querySelector('#mode-tabs button[data-mode="shelf"]')?.click()`);
await sleep(1000);
const names2 = await evalJs('window.__shelf.names()');
const same = JSON.stringify(names) === JSON.stringify(names2);
console.log(`determinism: ${same ? 'identical order across reload' : 'DIVERGED'}`);
if (!same) failures.push('entry order not deterministic across reload');

ws.close();
if (failures.length > 0) {
  console.log('FAIL:', failures.join(' | '));
  process.exit(1);
}
console.log('SHELF VERIFIED');
process.exit(0);
