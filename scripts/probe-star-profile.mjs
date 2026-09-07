import fs from 'node:fs';
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
  `GET ${url.pathname} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
);
let buf = Buffer.alloc(0);
let upgraded = false;
const pending = new Map();
let nextId = 1;
socket.on('data', (c) => {
  buf = Buffer.concat([buf, c]);
  if (!upgraded) {
    const i = buf.indexOf('\r\n\r\n');
    if (i === -1) return;
    buf = buf.subarray(i + 4);
    upgraded = true;
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
socket.on('data', () => {});
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
  if (!r?.data) throw new Error('no screenshot data: ' + JSON.stringify(r).slice(0, 300));
  const png = Buffer.from(r.data, 'base64');
  fs.writeFileSync('C:\\Users\\rhlin\\AppData\\Local\\Temp\\uni-zoom.png', png);
  return png;
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
const lum = (img, x, y) => {
  const i = (y * img.stride + x) * 3;
  return 0.2126 * img.px[i] + 0.7152 * img.px[i + 1] + 0.0722 * img.px[i + 2];
};

await evalJs(`document.querySelector('#mode-tabs button[data-mode="universe"]')?.click()`);
await sleep(1500);

const star = await evalJs(`(() => {
  let best = null;
  for (const el of document.querySelectorAll('.uni-star')) {
    const d = parseFloat(el.style.getPropertyValue('--d'));
    if (best === null || d > best.d) best = { d, el };
  }
  const r = best.el.getBoundingClientRect();
  return { name: best.el.dataset.name, d: best.d, x: r.x + r.width / 2, y: r.y + r.height / 2 };
})()`);
console.log('biggest star:', JSON.stringify(star));

for (let i = 0; i < 12; i++) {
  await evalJs(`(() => {
    const u = document.querySelector('#universe');
    u.dispatchEvent(new WheelEvent('wheel', { clientX: ${star.x}, clientY: ${star.y}, deltaY: -400, bubbles: true, cancelable: true }));
  })()`);
  await sleep(120);
}
await sleep(2000);

const st2 = await evalJs(`(() => {
  const el = [...document.querySelectorAll('.uni-star')].find((e) => e.dataset.name === ${JSON.stringify(star.name)});
  const r = el.getBoundingClientRect();
  const u = document.querySelector('#universe');
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, zoom: u.style.getPropertyValue('--uni-zoom') };
})()`);
console.log('zoomed star:', JSON.stringify(st2));

const img = decode(await shot());
console.log("decoded:", img.width, "x", img.height, "stride:", img.stride);
const scale = img.width / 1920;
const cx = Math.round(st2.x * scale);
const cy = Math.round(st2.y * scale);
console.log('--- radial luminance profile (8-direction average) ---');
for (let rad = 0; rad <= Math.min(140, Math.round(st2.w * 1.6)); rad += 2) {
  let sum = 0;
  let n = 0;
  for (let a = 0; a < 360; a += 15) {
    const x = Math.min(img.width - 1, Math.max(0, Math.round(cx + Math.cos((a * Math.PI) / 180) * rad)));
    const y = Math.min(img.height - 1, Math.max(0, Math.round(cy + Math.sin((a * Math.PI) / 180) * rad)));
    sum += lum(img, x, y);
    n++;
  }
  const bar = '#'.repeat(Math.round(sum / n / 4));
  console.log(`r=${String(rad).padStart(3)}: ${(sum / n).toFixed(1).padStart(6)} ${bar}`);
}
process.exit(0);
