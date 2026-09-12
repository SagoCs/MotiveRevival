import net from 'node:net';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const port = process.env.RIVER_PORT ?? '9222';
setTimeout(() => { console.error('probe watchdog: 120s without finishing'); process.exit(2); }, 120000).unref();

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
const errors = [];
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
    if (!head.includes(' 101 ')) {
      console.error('handshake refused:', head.split('\r\n')[0]);
      process.exit(2);
    }
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
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        errors.push(`${d.text} ${d.exception?.description ?? ''}`);
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        errors.push('console.error: ' + JSON.stringify(msg.params.args));
      } else if (msg.id !== undefined && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(JSON.stringify(msg.error)));
        else res(msg.result);
      }
    }
  }
});
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
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
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

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
  if (!ok) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await handshake;
await send('Runtime.enable');
await send('Page.enable');
await sleep(1500);

const tabCenter = await evalJs(`JSON.stringify((() => { const b = document.querySelector('#mode-tabs button[data-mode="songs"]'); if (b === null) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })())`);
if (tabCenter === null) throw new Error('songs tab button not found');
const tab = JSON.parse(tabCenter);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: tab.x, y: tab.y, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tab.x, y: tab.y, button: 'left', clickCount: 1 });
await sleep(2000);

const pressF9 = async () => {
  await evalJs(`(() => { const b = document.querySelector('#mode-tabs button[data-mode="songs"]'); if (b !== null) b.focus(); return 'ok'; })()`);
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'F9', code: 'F9', windowsVirtualKeyCode: 120, nativeVirtualKeyCode: 120 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'F9', code: 'F9', windowsVirtualKeyCode: 120, nativeVirtualKeyCode: 120 });
};

const state = async () => JSON.parse(await evalJs(`JSON.stringify({
  v2Active: document.body.classList.contains('river-v2-active'),
  v2On: document.querySelector('#river-v2')?.classList.contains('on') ?? false,
  v2Mounted: document.querySelector('#river-v2') !== null,
  liveDisplay: getComputedStyle(document.querySelector('#song-river')).display,
  slabCount: document.querySelectorAll('#river-v2 .rv2-card').length,
  region: (() => { const r = document.querySelector('#river-v2')?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; })(),
  visible: [...document.querySelectorAll('#river-v2 .rv2-card')].filter((el) => el.style.visibility !== 'hidden').map((el) => { const r = el.getBoundingClientRect(); return { t: +r.top.toFixed(2), b: +r.bottom.toFixed(2), l: +r.left.toFixed(2), rt: +r.right.toFixed(2), h: +r.height.toFixed(2), op: +(+el.style.opacity).toFixed(3) }; }),
  activeTab: document.querySelector('#mode-tabs button.active')?.getAttribute('data-mode') ?? null,
  liveOn: document.querySelector('#song-river')?.classList.contains('on') ?? false
})`));

let s = await state();
while (s.v2Active) {
  await pressF9();
  await sleep(500);
  s = await state();
}

await evalJs(`(() => { window.__f9probeDowns = 0; if (!window.__f9probeCounting) { window.__f9probeCounting = true; window.addEventListener('keydown', (e) => { if (e.key === 'F9') window.__f9probeDowns++; }); } return 'ok'; })()`);
await evalJs(`(() => { const b = document.querySelector('#mode-tabs button[data-mode="songs"]'); if (b !== null) b.focus(); return document.hasFocus(); })()`);
await evalJs('window.__f9probeDowns = 0');
await pressF9();
await sleep(1000);
const downs = await evalJs('window.__f9probeDowns');
check('exactly one keydown delivered per press', downs === 1, `${downs} keydown(s)`);
const on = await state();
check('F9 activates lab', on.v2Active && on.v2On && on.v2Mounted, JSON.stringify({ active: on.v2Active, on: on.v2On, mounted: on.v2Mounted }));
check('live river hidden while lab active', on.liveDisplay === 'none', `#song-river display: ${on.liveDisplay}`);
check('slabs built from real library', on.slabCount > 0, `${on.slabCount} slabs`);

const geometryReady = on.v2On && on.region !== null && on.region.h > 0;
check('geometry measurable (layer displayed)', geometryReady, on.region ? `region ${on.region.w}x${on.region.h}` : 'no region');

if (geometryReady && on.visible.length > 0) {
  check('some slabs visible', true, `${on.visible.length} visible`);
  const tol = Math.max(2, on.region.h * 0.02);
  const outside = on.visible.filter((r) => r.t < on.region.y - tol || r.b > on.region.y + on.region.h + tol);
  check('visible cards inside region', outside.length === 0, outside.length ? JSON.stringify(outside[0]) : `tol ${tol.toFixed(1)}px`);
  const sortedV = [...on.visible].filter((r) => r.op >= 0.7).sort((a, b) => a.t - b.t);
  const ws = [];
  for (let i = 1; i < sortedV.length; i++) {
    const gap = sortedV[i].t - sortedV[i - 1].b;
    const size = (sortedV[i].h + sortedV[i - 1].h) / 2;
    ws.push({ gap, norm: gap / size });
  }
  const norms = ws.map((w) => w.norm);
  const posNorms = norms.filter((v) => v > 0);
  const median = posNorms.length ? [...posNorms].sort((a, b) => a - b)[Math.floor(posNorms.length / 2)] ?? 0 : 0;
  const maxPos = posNorms.length ? Math.max(...posNorms) : 0;
  const gapsAbs = ws.map((w) => w.gap);
  const medianGap = gapsAbs.length ? [...gapsAbs].sort((a, b) => a - b)[Math.floor(gapsAbs.length / 2)] ?? 0 : 0;
  const maxGap = gapsAbs.length ? Math.max(...gapsAbs) : 0;
  const deepOverlap = norms.some((v) => v < -0.5);
  check('inter-card air does not balloon outward', median > 0 && maxPos / median < 3 && maxGap / medianGap < 2.5 && !deepOverlap, `fractions ${norms.map((v) => v.toFixed(3)).join(',')} | gaps ${gapsAbs.map((v) => v.toFixed(0)).join(',')}px`);
  let maxOverlap = 0;
  for (let i = 1; i < sortedV.length; i++) {
    const overlap = Math.min(sortedV[i - 1].b, sortedV[i].b) - Math.max(sortedV[i - 1].t, sortedV[i].t);
    if (overlap > 0) maxOverlap = Math.max(maxOverlap, overlap);
  }
  const slotH = on.region.h / 7;
  check('adjacent AABB overlap under 25% of slot', maxOverlap < slotH * 0.25, `max ${maxOverlap.toFixed(1)}px of ${slotH.toFixed(1)}px slot`);
  const cyAbs = on.region.y + on.region.h / 2;
  const centerCard = on.visible.reduce((best, r) => (Math.abs((r.t + r.b) / 2 - cyAbs) < Math.abs((best.t + best.b) / 2 - cyAbs) ? r : best));
  const otherHeights = on.visible.filter((r) => r !== centerCard).map((r) => r.h);
  check('center card lensed larger', otherHeights.length === 0 || centerCard.h > Math.max(...otherHeights) + 4, `center ${centerCard.h.toFixed(1)}px vs max other ${otherHeights.length ? Math.max(...otherHeights).toFixed(1) : 'n/a'}px`);
} else {
  check('some slabs visible', false, on.visible.length === 0 ? 'none visible' : 'geometry unavailable');
  check('visible cards inside region', false, 'skipped - geometry unavailable');
  check('visible centers one slot apart', false, 'skipped - geometry unavailable');
  check('adjacent AABB overlap under 25% of slot', false, 'skipped - geometry unavailable');
}

const shot = await send('Page.captureScreenshot', { format: 'png' });
const shotBuf = Buffer.from(shot.data, 'base64');
const { writeFileSync } = await import('node:fs');
writeFileSync(`${process.cwd()}\\river-lab-latest.png`, shotBuf);
const img = decode(shotBuf);
const artState = await evalJs(`JSON.stringify({
  cards: document.querySelectorAll('#river-v2 .rv2-card').length,
  imgs: [...document.querySelectorAll('#river-v2 .rv2-art img')].slice(0, 20).filter((i) => i.complete && i.naturalWidth > 0).length,
  imgsTotal: Math.min(20, document.querySelectorAll('#river-v2 .rv2-art img').length)
})`);
const art = JSON.parse(artState);
check('card art images loaded', art.imgs === art.imgsTotal, `${art.imgs}/${art.imgsTotal} loaded`);
if (geometryReady && on.visible.length >= 3) {
  const center = on.visible.slice().sort((a, b) => (a.t + a.b) / 2 - (b.t + b.b) / 2)[Math.floor(on.visible.length / 2)];
  let samples = 0;
  let lit = 0;
  for (let yy = center.t + center.h * 0.15; yy <= center.b - center.h * 0.15; yy += 3) {
    for (let xx = center.l + 10; xx <= center.rt - 10; xx += 6) {
      const xi = Math.min(img.width - 1, Math.max(0, Math.round(xx)));
      const yi = Math.min(img.height - 1, Math.max(0, Math.round(yy)));
      const i = yi * img.stride + xi * 3;
      const lum = 0.2126 * img.px[i] + 0.7152 * img.px[i + 1] + 0.0722 * img.px[i + 2];
      samples++;
      if (lum > 25) lit++;
    }
  }
  const frac = samples > 0 ? lit / samples : 0;
  check('center card actually paints', frac > 0.05, `${(frac * 100).toFixed(1)}% of ${samples} samples lit`);
} else {
  check('center card actually paints', false, 'skipped - no geometry');
}

await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await sleep(1000);
const rs = await state();
check('resize: lab still active', rs.v2On && rs.region !== null && rs.region.h > 0, rs.region ? `region ${rs.region.w}x${rs.region.h}` : 'no region');
if (rs.v2On && rs.region !== null && rs.region.h > 0 && rs.visible.length > 0) {
  const rTol = Math.max(2, rs.region.h * 0.02);
  const rOutside = rs.visible.filter((r) => r.t < rs.region.y - rTol || r.b > rs.region.y + rs.region.h + rTol);
  check('resize: visible cards inside smaller region', rOutside.length === 0, rOutside.length ? JSON.stringify(rOutside[0]) : `${rs.region.w}x${rs.region.h}`);
  const rSorted = [...rs.visible].filter((r) => r.op >= 0.7).sort((a, b) => a.t - b.t);
  const rWs = [];
  for (let j = 1; j < rSorted.length; j++) {
    const g = rSorted[j].t - rSorted[j - 1].b;
    const sz = (rSorted[j].h + rSorted[j - 1].h) / 2;
    if (sz > 0) rWs.push(g / sz);
  }
  const rPos = rWs.filter((v) => v > 0);
  const rMedian = rPos.length ? [...rPos].sort((a, b) => a - b)[Math.floor(rPos.length / 2)] ?? 0 : 0;
  const rMaxPos = rPos.length ? Math.max(...rPos) : 0;
  const rDeep = rWs.some((v) => v < -0.5);
  check('resize: air does not balloon outward at smaller region', rPos.length >= 3 && rMedian > 0 && rMaxPos / rMedian < 3 && !rDeep, `fractions ${rWs.map((v) => v.toFixed(3)).join(',')}`);
} else {
  check('resize: visible cards inside smaller region', false, 'skipped - geometry unavailable');
  check('resize: slot spacing re-derived', false, 'skipped - geometry unavailable');
}
await send('Emulation.clearDeviceMetricsOverride', {});
await sleep(800);

const labReady = await evalJs(`window.__riverV2Lab ? 'ok' : 'missing'`);
check('lab debug handle exposed', labReady === 'ok', String(labReady));
if (labReady === 'ok') {
  const setN = async (n) => {
    const ids = ['a', 'b', 'c'];
    await evalJs(`__riverV2Lab.river().setEntries([${ids.slice(0, n).map((id) => `{id:'${id}',title:'Entry ${id}',meta:[],art:null}`).join(',')}])`);
    await sleep(400);
    return state();
  };
  const cyOf = (s) => s.region.y + s.region.h / 2;
  const one = await setN(1);
  const oneCenter = one.visible.length === 1 ? (one.visible[0].t + one.visible[0].b) / 2 - cyOf(one) : NaN;
  check('one song centers alone', one.visible.length === 1 && Math.abs(oneCenter) < 2, one.visible.length === 1 ? `offset ${oneCenter.toFixed(1)}px` : `${one.visible.length} visible`);
  const two = await setN(2);
  const twoC = two.visible.map((r) => (r.t + r.b) / 2 - cyOf(two)).sort((a, b) => a - b);
  check('two songs straddle symmetric', two.visible.length === 2 && Math.abs(twoC[0] + twoC[1]) < 2 && twoC[1] - twoC[0] > 10, `offsets ${twoC.map((v) => v.toFixed(1)).join(',')}`);
  await evalJs('__riverV2Lab.river().scrollTo(0)');
  await sleep(300);
  const twoPinned = await state();
  const twoPC = twoPinned.visible.map((r) => (r.t + r.b) / 2 - cyOf(twoPinned)).sort((a, b) => a - b);
  check('small set pinned (scroll ignored)', twoPC.length === 2 && Math.abs(twoPC[0] - twoC[0]) < 1 && Math.abs(twoPC[1] - twoC[1]) < 1, `offsets ${twoPC.map((v) => v.toFixed(1)).join(',')}`);
  const three = await setN(3);
  const threeC = three.visible.map((r) => (r.t + r.b) / 2 - cyOf(three)).sort((a, b) => a - b);
  check('three songs center their middle', three.visible.length === 3 && Math.abs(threeC[1]) < 2, `offsets ${threeC.map((v) => v.toFixed(1)).join(',')}`);
  await evalJs('__riverV2Lab.reload()');
  await sleep(600);
  const restored = await state();
  check('real library restored after small-set tests', restored.slabCount === on.slabCount, `${restored.slabCount} slabs`);
  const thirty = Array.from({ length: 30 }, (_, i) => `{id:'e${i}',title:'S ${i}',meta:[],art:null}`).join(',');
  await evalJs(`__riverV2Lab.river().setEntries([${thirty}])`);
  await evalJs('__riverV2Lab.river().scrollTo(2)');
  await sleep(400);
  const sh = await state();
  const cyS = sh.region.y + sh.region.h / 2;
  const strong = sh.visible.filter((r) => r.op >= 0.45).map((r) => (r.t + r.b) / 2 - cyS);
  const above = strong.filter((v) => v < -4).length;
  const below = strong.filter((v) => v > 4).length;
  check('shorten: band symmetric near list start', Math.abs(above - below) <= 1, `${above} above / ${below} below at anchor 2 of 30`);
  const maxOff = Math.max(...sh.visible.map((r) => Math.abs((r.t + r.b) / 2 - cyS)));
  check('shorten: band compressed near edge', maxOff < sh.region.h * 0.375, `max offset ${maxOff.toFixed(0)}px vs half region ${(sh.region.h / 2).toFixed(0)}px`);
  await evalJs('__riverV2Lab.river().scrollTo(15)');
  await sleep(500);
  const edgeShot = await send('Page.captureScreenshot', { format: 'png' });
  const eimg = decode(Buffer.from(edgeShot.data, 'base64'));
  let litTop = 0;
  let litBottom = 0;
  for (let y = 0; y < eimg.height; y += 2) {
    if (y < on.region.y + 1 || y >= on.region.y + on.region.h - 1) continue;
    const inTop = y <= on.region.y + 34;
    const inBottom = y >= on.region.y + on.region.h - 35;
    if (!inTop && !inBottom) continue;
    for (let x = 0; x < eimg.width; x += 4) {
      const i = y * eimg.stride + x * 3;
      const lum = 0.2126 * eimg.px[i] + 0.7152 * eimg.px[i + 1] + 0.0722 * eimg.px[i + 2];
      if (lum > 25) {
        if (inTop) litTop++;
        else litBottom++;
      }
    }
  }
  check('edge fade: top band dissolves to void', litTop < 25, `${litTop} lit samples in top strip`);
  check('edge fade: bottom band dissolves to void', litBottom < 25, `${litBottom} lit samples in bottom strip`);
  await evalJs('__riverV2Lab.reload()');
  await sleep(600);

  const region = on.region;
  const vx = region.x + Math.max(60, region.w * 0.04);
  const vy = region.y + region.h / 2;
  const h0 = await evalJs('__riverV2Lab.homeIndex()');
  await evalJs(`__riverV2Lab.river().scrollTo(${Math.min(h0 + 5, 157)})`);
  await sleep(300);

  await evalJs(`(() => { window.__posTrace = []; const t0 = performance.now(); const grab = () => { const out = []; for (const el of document.querySelectorAll('#river-v2 .rv2-card')) { if (el.style.visibility === 'hidden') continue; const r = el.getBoundingClientRect(); if (r.height < 4) continue; out.push([+el.dataset.index, +r.top.toFixed(2)]); } return out; }; const loop = () => { window.__posTrace.push([Math.round(performance.now() - t0), +__riverV2Lab.river().scrollPosition().toFixed(4), grab()]); if (performance.now() - t0 < 2600) requestAnimationFrame(loop); }; requestAnimationFrame(loop); return 'ok'; })()`);
  for (let k = 0; k < 7; k++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: vx, y: vy, deltaX: 0, deltaY: 40 });
    await sleep(140);
  }
  await sleep(2300);
  const trace = JSON.parse(await evalJs('JSON.stringify(window.__posTrace)'));
  const deltas = [];
  for (let k = 1; k < trace.length; k++) {
    const d = trace[k][1] - trace[k - 1][1];
    if (Math.abs(d) > 0.004) deltas.push(d);
  }
  let flips = 0;
  for (let k = 1; k < deltas.length; k++) {
    if (deltas[k] * (deltas[k - 1] ?? 0) < 0) flips++;
  }
  check('slow scroll: no shimmer reversals', deltas.length > 20 && flips <= 1, `${deltas.length} moving deltas, ${flips} reversals`);
  let worst = { excess: -Infinity };
  const slotPx = on.region.h / 7;
  for (let k = 1; k < trace.length; k++) {
    const dPos = Math.abs(trace[k][1] - trace[k - 1][1]);
    const bound = dPos * slotPx + 3;
    const prev = new Map(trace[k - 1][2].map((c) => [c[0], c[1]]));
    for (const [idx, top] of trace[k][2]) {
      const p = prev.get(idx);
      if (p === undefined) continue;
      const excess = Math.abs(top - p) - bound;
      if (excess > worst.excess) worst = { excess, idx, at: trace[k][0], d: +(top - p).toFixed(2), bound: +bound.toFixed(2) };
    }
  }
  check('slow scroll: no per-frame card pops', worst.excess <= 0, worst.excess > 0 ? `card ${worst.idx} moved ${worst.d}px vs motion bound ${worst.bound}px at t=${worst.at}` : `worst step within motion bound (margin ${(-worst.excess).toFixed(2)}px)`);
  const posA = await evalJs('__riverV2Lab.river().scrollPosition()');
  await sleep(700);
  const posB = await evalJs('__riverV2Lab.river().scrollPosition()');
  check('park: position frozen at idle', posA === posB, `${posA} vs ${posB}`);

  const posBefore = await evalJs('__riverV2Lab.river().scrollPosition()');
  const dy0 = region.y + region.h * 0.75;
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: vx, y: dy0, button: 'left', clickCount: 1 });
  for (let k = 1; k <= 12; k++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: vx, y: dy0 - k * 20, button: 'left' });
    await sleep(16);
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: vx, y: dy0 - 240, button: 'left', clickCount: 1 });
  const posDrag = await evalJs('__riverV2Lab.river().scrollPosition()');
  check('drag-pan moves the river', posDrag > posBefore + 1.2, `${posBefore.toFixed(2)} -> ${posDrag.toFixed(2)}`);
  await sleep(250);
  const posFling = await evalJs('__riverV2Lab.river().scrollPosition()');
  check('release fling continues motion', posFling > posDrag + 0.05, `${posDrag.toFixed(2)} -> ${posFling.toFixed(2)}`);
  await sleep(1800);

  const home = await evalJs('__riverV2Lab.homeIndex()');
  await evalJs(`__riverV2Lab.river().scrollTo(${Math.min(home + 20, 157)})`);
  await sleep(300);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: vx, y: vy, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: vx, y: vy, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: vx, y: vy, button: 'left', clickCount: 2 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: vx, y: vy, button: 'left', clickCount: 2 });
  await sleep(1600);
  const posHome = await evalJs('__riverV2Lab.river().scrollPosition()');
  const centerIdx = await evalJs(`(() => { const el = document.elementFromPoint(${region.x + region.w / 2}, ${vy})?.closest('.rv2-card'); return el?.dataset.index ?? null; })()`);
  check('double-click glides home', Math.abs(posHome - home) < 0.02, `pos ${posHome.toFixed(3)} vs home ${home}`);
  check('home card centered after glide', centerIdx === String(home), `center index ${centerIdx}, home ${home}`);

  await evalJs('__riverV2Lab.river().scrollTo(0)');
  await sleep(200);
  for (let k = 0; k < 15; k++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: vx, y: vy, deltaX: 0, deltaY: 200 });
  }
  await sleep(600);
  const posTop = await evalJs('__riverV2Lab.river().scrollPosition()');
  check('clamps at list start', Math.abs(posTop) < 0.001, `pos ${posTop}`);
  const libCount = await evalJs('document.querySelectorAll("#river-v2 .rv2-card").length');
  await evalJs(`__riverV2Lab.river().scrollTo(${libCount - 1})`);
  await sleep(200);
  for (let k = 0; k < 15; k++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: vx, y: vy, deltaX: 0, deltaY: -200 });
  }
  await sleep(600);
  const posEnd = await evalJs('__riverV2Lab.river().scrollPosition()');
  check('clamps at list end', Math.abs(posEnd - (libCount - 1)) < 0.001, `pos ${posEnd} vs ${libCount - 1}`);
}

await pressF9();
await sleep(800);
const off = await state();
check('F9 deactivates lab', !off.v2Active && !off.v2On);
check('live river restored on Songs tab', off.liveDisplay !== 'none' && off.activeTab === 'songs' && off.liveOn, `display: ${off.liveDisplay}, tab: ${off.activeTab}, live .on: ${off.liveOn}`);

const knownArtifact = errors.filter((e) => e.includes('closest is not a function') && e.includes('renderer.js'));
const realErrors = errors.filter((e) => !knownArtifact.includes(e));
check('no real renderer errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
if (knownArtifact.length > 0) {
  console.log(`NOTE  ${knownArtifact.length} known CDP artifact(s) tolerated: unfocused-window key dispatch targets the document; real keydowns always target an Element`);
}
console.log(failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
