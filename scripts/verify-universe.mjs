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
    const b0 = buf[0];
    const b1 = buf[1];
    const opcode = b0 & 0x0f;
    let len = b1 & 0x7f;
    let off = 2;
    if (len === 126) {
      if (buf.length < 4) return;
      len = buf.readUInt16BE(2);
      off = 4;
    } else if (len === 127) {
      if (buf.length < 10) return;
      len = Number(buf.readBigUInt64BE(2));
      off = 10;
    }
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

function send(method, params = {}) {
  const id = nextId++;
  const data = Buffer.from(JSON.stringify({ id, method, params }), 'utf8');
  const mask = crypto.randomBytes(4);
  let header;
  if (data.length < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = 0x80 | data.length;
  } else {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(data.length, 2);
  }
  const masked = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
  socket.write(Buffer.concat([header, mask, masked]));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evalJs(expr, awaitPromise = false) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result?.value;
}

console.log('title:', await evalJs('document.title'));
await evalJs(`document.querySelector('#mode-tabs button[data-mode="universe"]')?.click()`);
await sleep(1600);

const info = await evalJs(`(() => {
  const u = document.querySelector('#universe');
  const stars = document.querySelectorAll('.uni-star').length;
  const sparks = document.querySelectorAll('.uni-spark').length;
  const hole = document.querySelector('.uni-hole') !== null;
  const labels = document.querySelectorAll('.uni-star-label').length;
  const fstars = document.querySelectorAll('.uni-fstar').length;
  const twinkles = document.querySelectorAll('.uni-fstar.twink').length;
  return { hidden: u ? u.hidden : null, cls: u ? u.className : null, stars, sparks, hole, labels, fstars, twinkles, zoom: u ? u.style.getPropertyValue('--uni-zoom') : null };
})()`);
console.log('dom:', JSON.stringify(info));

const shot = await send('Page.captureScreenshot', { format: 'png' });
const png = Buffer.from(shot.data, 'base64');

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

function sample(x, y) {
  const i = (y * width + x) * 3;
  return [px[i], px[i + 1], px[i + 2]];
}
function lum(x, y) {
  const [r, g, b] = sample(x, y);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const cx0 = await evalJs(`(() => {
  const h = document.querySelector('.uni-hole');
  if (!h) return null;
  const r = h.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width) };
})()`);
if (cx0 === null) throw new Error('no hole on screen');
const scale = width / (await evalJs('innerWidth'));
const cx = Math.round(cx0.x * scale);
const cy = Math.round(cx0.y * scale);
let holeLum = 255;
const patch = Math.max(4, Math.round(cx0.w * scale * 0.18));
for (let dy = -patch; dy <= patch; dy += 3) {
  for (let dx = -patch; dx <= patch; dx += 3) {
    holeLum = Math.min(holeLum, lum(cx + dx, cy + dy));
  }
}
let ringPeak = 0;
let ringDx = 0;
const scanLo = Math.max(10, Math.round(cx0.w * scale * 0.55));
const scanHi = Math.min(320, Math.round(cx0.w * scale * 1.9));
for (let dx = scanLo; dx <= scanHi; dx += 2) {
  for (let dy = -Math.round(cx0.w * scale * 0.3); dy <= Math.round(cx0.w * scale * 0.3); dy += 6) {
    const x = Math.min(width - 1, Math.max(0, cx + dx));
    const y = Math.min(height - 1, Math.max(0, cy + dy));
    const l = lum(x, y);
    if (l > ringPeak) { ringPeak = l; ringDx = dx; }
  }
}
let litCount = 0;
let totalLum = 0;
const samples = 4000;
for (let i = 0; i < samples; i++) {
  const x = 8 + Math.floor((i * 7919) % (width - 16));
  const y = 8 + Math.floor((i * 104729) % (height - 16));
  const l = lum(x, y);
  totalLum += l;
  if (l > 28) litCount++;
}
let glowPeak = 0;
for (let dx = 90; dx <= 260; dx += 6) {
  for (let dy = -60; dy <= 60; dy += 6) {
    const x = Math.min(width - 1, cx + dx);
    const y = Math.min(height - 1, Math.max(0, cy + dy));
    glowPeak = Math.max(glowPeak, lum(x, y));
  }
}
console.log('png:', width, 'x', height, 'zoom:', info.zoom);
console.log('hole-screen:', JSON.stringify(cx0));
console.log('hole-center-lum:', holeLum.toFixed(1));
console.log('ring-peak-lum:', ringPeak.toFixed(1), 'at dx', ringDx, '(scan', scanLo, '-', scanHi + ')');
console.log('field-lit-frac:', (litCount / samples).toFixed(3), 'mean-lum:', (totalLum / samples).toFixed(2));
console.log('glow-zone-peak:', glowPeak.toFixed(1));
console.log('verdict:', holeLum < 16 && ringPeak > 45 && info.fstars >= 50 && info.fstars <= 80 && info.twinkles >= 10 ? 'PASS' : 'CHECK');
process.exit(0);
