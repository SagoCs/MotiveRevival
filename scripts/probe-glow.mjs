import net from 'node:net';
import crypto from 'node:crypto';

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

await evalJs(`document.querySelector('#mode-tabs button[data-mode="universe"]')?.click()`);
await sleep(1500);

const report = await evalJs(`(() => {
  const cv = document.querySelector('.uni-halo canvas');
  if (!cv) return 'no halo canvas';
  const ctx = cv.getContext('2d');
  const W = WORLD_W_FALLBACK = 3600;
  const scaleX = cv.width / 3600;
  const out = [];
  for (const el of document.querySelectorAll('.uni-star')) {
    const wx = parseFloat(el.style.left);
    const wy = parseFloat(el.style.top);
    const cx = wx * scaleX;
    const cy = wy * scaleX;
    const box = Math.max(6, Math.round((parseFloat(el.style.getPropertyValue('--d')) || 24) * 0.45 * scaleX));
    const d = ctx.getImageData(cx - box, cy - box, box * 2, box * 2).data;
    let rs = 0, gs = 0, bs = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 6) { rs += d[i]; gs += d[i + 1]; bs += d[i + 2]; n++; }
    }
    if (n === 0) { out.push({ name: el.dataset.name, empty: true }); continue; }
    const r = rs / n / 255, g = gs / n / 255, b = bs / n / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const dd = max - min;
    let h = 0;
    if (dd !== 0) {
      if (max === r) h = ((g - b) / dd + (g < b ? 6 : 0)) * 60;
      else if (max === g) h = ((b - r) / dd + 2) * 60;
      else h = ((r - g) / dd + 4) * 60;
    }
    const l = (max + min) / 2;
    const s = dd === 0 ? 0 : dd / (1 - Math.abs(2 * l - 1));
    out.push({ name: el.dataset.name, hue: Math.round(h), sat: Math.round(s * 100), lum: Math.round(l * 100), samples: n });
  }
  return out;
})()`);
console.log(JSON.stringify(report, null, 1));
process.exit(0);
