import net from 'node:net';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const targets = await fetch('http://127.0.0.1:9222/json').then((r) => r.json());
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('no page target');
const url = new URL(page.webSocketDebuggerUrl.replace('ws://', 'http://'));
const key = crypto.randomBytes(16).toString('base64');
const socket = net.connect(Number(url.port), '127.0.0.1');
await new Promise((res, rej) => { socket.once('connect', res); socket.once('error', rej); });
socket.write(
  `GET ${url.pathname} HTTP/1.1\r\nHost: 127.0.0.1:${url.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
);
let buf = Buffer.alloc(0);
let upgraded = false;
const pending = new Map();
let nextId = 1;
function feed(chunk) {
  buf = Buffer.concat([buf, chunk]);
  if (!upgraded) {
    const idx = buf.indexOf('\r\n\r\n');
    if (idx === -1) return;
    buf = buf.subarray(idx + 4);
    upgraded = true;
  }
  while (true) {
    if (buf.length < 2) return;
    const opcode = buf[0] & 0x0f;
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
}
socket.on('data', feed);
socket.on('close', () => process.exit(0));
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result?.value;
}
async function shot() {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  return Buffer.from(r.data, 'base64');
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

const env = await evalJs(`({ dpr: window.devicePixelRatio, iw: innerWidth, ih: innerHeight, sx: screen.width, sy: screen.height })`);
console.log('env:', JSON.stringify(env));

await evalJs(`document.querySelector('#mode-tabs button[data-mode="universe"]')?.click()`);
await sleep(1400);

const nodes = await evalJs(`(() => {
  const u = document.querySelector('#universe');
  const pick = (sel, n) => [...u.querySelectorAll(sel)].slice(0, n).map((el) => {
    const r = el.getBoundingClientRect();
    return { name: el.dataset.name ?? sel, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
  });
  return { zoom: u.style.getPropertyValue('--uni-zoom'), stars: pick('.uni-star', 6), hole: pick('.uni-hole', 1)[0] };
})()`);
console.log('nodes:', JSON.stringify(nodes));

function measureBlob(img, cxp, cyp, box, tag) {
  const x0 = Math.max(0, Math.round(cxp - box));
  const x1 = Math.min(img.width - 1, Math.round(cxp + box));
  const y0 = Math.max(0, Math.round(cyp - box));
  const y1 = Math.min(img.height - 1, Math.round(cyp + box));
  let peak = 0;
  const lums = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * img.stride + x * 3;
      const l = 0.2126 * img.px[i] + 0.7152 * img.px[i + 1] + 0.0722 * img.px[i + 2];
      lums.push({ x, y, l });
      if (l > peak) peak = l;
    }
  }
  const thr = peak * 0.45;
  const above = lums.filter((p) => p.l > thr);
  const xs = above.map((p) => p.x);
  const ys = above.map((p) => p.y);
  const w = above.length ? Math.max(...xs) - Math.min(...xs) + 1 : 0;
  const h = above.length ? Math.max(...ys) - Math.min(...ys) + 1 : 0;
  const fill = above.length && w * h ? above.length / (w * h) : 0;
  console.log(`${tag}: peak=${peak.toFixed(0)} blobW=${w} blobH=${h} fillRatio=${fill.toFixed(2)} px=${above.length}`);
}

let img = decode(await shot());
const scale = img.width / env.iw;
console.log('shot:', img.width, 'x', img.height, 'scale:', scale.toFixed(3));
for (const s of nodes.stars.slice(0, 4)) {
  measureBlob(img, s.x * scale, s.y * scale, Math.max(14, s.w), `star ${s.name}`);
}
if (nodes.hole) measureBlob(img, nodes.hole.x * scale, nodes.hole.y * scale, Math.round(nodes.hole.w * 0.62), 'hole');

await evalJs(`(() => {
  const u = document.querySelector('#universe');
  const star = u.querySelector('.uni-star');
  const r = star.getBoundingClientRect();
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  for (let i = 0; i < 10; i++) {
    u.dispatchEvent(new WheelEvent('wheel', { clientX: cx, clientY: cy, deltaY: -420, bubbles: true, cancelable: true }));
  }
  return { cx, cy };
})()`);
await sleep(2200);

const zoom2 = await evalJs(`document.querySelector('#universe').style.getPropertyValue('--uni-zoom')`);
console.log('zoom-after-wheel:', zoom2);
img = decode(await shot());
const scale2 = img.width / env.iw;
const nodes2 = await evalJs(`(() => {
  const u = document.querySelector('#universe');
  const pick = (sel, n) => [...u.querySelectorAll(sel)].slice(0, n).map((el) => {
    const r = el.getBoundingClientRect();
    return { name: el.dataset.name ?? sel, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width) };
  });
  return { stars: pick('.uni-star', 3), hole: pick('.uni-hole', 1)[0] };
})()`);
for (const s of nodes2.stars) {
  measureBlob(img, s.x * scale2, s.y * scale2, Math.max(14, s.w), `zoomed star ${s.name}`);
}
if (nodes2.hole) measureBlob(img, nodes2.hole.x * scale2, nodes2.hole.y * scale2, Math.round(nodes2.hole.w * 0.62), 'zoomed hole');

const density = await evalJs(`(() => {
  const cv = document.querySelector('.uni-near canvas');
  const ctx = cv.getContext('2d');
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  let lit = 0; let big = 0;
  const sizes = [];
  for (let i = 3; i < d.length; i += 4) if (d[i] > 12) lit++;
  return { nearLitPx: lit, bitmap: cv.width + 'x' + cv.height, css: cv.offsetWidth + 'x' + cv.offsetHeight };
})()`);
console.log('near-sheet:', JSON.stringify(density));
process.exit(0);
