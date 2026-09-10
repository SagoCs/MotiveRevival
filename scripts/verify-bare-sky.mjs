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
await sleep(1400);

const dom = await evalJs(`(() => {
  const u = document.querySelector('#universe');
  return {
    present: u !== null,
    hidden: u ? u.hidden : null,
    on: u ? u.classList.contains('on') : null,
    bodyActive: document.body.classList.contains('universe-active'),
    stars: document.querySelectorAll('.uni-star').length,
    sparks: document.querySelectorAll('.uni-spark').length,
    holes: document.querySelectorAll('.uni-hole').length,
    labels: document.querySelectorAll('.uni-star-label').length,
    fstars: document.querySelectorAll('.uni-fstar').length,
    threads: document.querySelectorAll('.uni-threads').length,
    canvases: u ? u.querySelectorAll('canvas').length : -1,
    children: u ? u.childElementCount : -1,
  };
})()`);
console.log('dom:', JSON.stringify(dom));

const failures = [];
if (!dom.present) failures.push('surface missing');
if (dom.hidden !== false || dom.on !== true || dom.bodyActive !== true) failures.push('surface not visible');
for (const k of ['stars', 'sparks', 'holes', 'labels', 'fstars', 'threads', 'canvases']) {
  if (dom[k] !== 0) failures.push(`${k} = ${dom[k]}`);
}
if (dom.children !== 0) failures.push(`surface children = ${dom.children}`);

await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4 });
await evalJs(`(() => {
  const ev = new PointerEvent('pointermove', { clientX: 4, clientY: innerHeight - 4, bubbles: true });
  document.body.dispatchEvent(ev);
  return true;
})()`);
await sleep(600);

const innerW = await evalJs('innerWidth');
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

function lum(x, y) {
  const i = (y * width + x) * 3;
  return 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
}

const scale = width / innerW;
const topCut = Math.round(72 * scale);
const botCut = Math.round(190 * scale);
const lanternX = Math.round(4 * scale);
const lanternY = height - Math.round(4 * scale);
const lanternR = Math.round(140 * scale);

let skyMax = 0;
let skyMaxAt = null;
let brightCount = 0;
let meanAcc = 0;
let meanN = 0;
for (let y = topCut; y < height - botCut; y += 2) {
  for (let x = 0; x < width; x += 2) {
    const l = lum(x, y);
    meanAcc += l;
    meanN += 1;
    if (Math.hypot(x - lanternX, y - lanternY) < lanternR) continue;
    if (l > skyMax) {
      skyMax = l;
      skyMaxAt = [x, y];
    }
    if (l > 60) brightCount += 1;
  }
}
const mean = meanAcc / meanN;
console.log(`sky band: max=${skyMax.toFixed(1)} at ${JSON.stringify(skyMaxAt)} bright(>60)=${brightCount} mean=${mean.toFixed(2)}`);
console.log(`(excluded top ${topCut}px bezel, bottom ${botCut}px transport, lantern r=${lanternR}px at corner)`);
if (skyMax > 60) failures.push(`bright pixels in sky band (max ${skyMax.toFixed(1)} at ${JSON.stringify(skyMaxAt)})`);

if (failures.length > 0) {
  console.log('FAIL:', failures.join(' | '));
  process.exit(1);
}
console.log('BARE SKY VERIFIED');
process.exit(0);
