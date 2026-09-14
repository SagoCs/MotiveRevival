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

await evalJs(`document.querySelector('#shelf-lens button:nth-child(2)')?.click()`);
await sleep(900);
const lens2 = await evalJs(`({ lens: window.__shelf.lens(), names: window.__shelf.names() })`);
console.log(`playlists lens: ${lens2.lens}, entries: ${lens2.names.length}`);
if (lens2.lens !== 'playlists') failures.push('lens switch failed');
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
