import net from 'node:net';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import fs from 'node:fs';
import { spawn, execSync } from 'node:child_process';

const root = 'C:\\Users\\rhlin\\Desktop\\Attempt3\\MotiveRevival';
const port = process.env.SANDBOX_PORT ?? '9223';
setTimeout(() => { console.error('probe watchdog: 100s without finishing'); process.exit(2); }, 100000).unref();

const child = spawn('cmd', ['/c', `cd /d ${root} && node_modules\\.bin\\electron.cmd sandbox\\dist\\main.js`], { stdio: 'ignore' });
const cleanup = () => {
  try {
    execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
  } catch {}
};
process.on('exit', cleanup);
process.on('uncaughtException', (err) => {
  console.error('probe failed:', err.message);
  cleanup();
  process.exit(1);
});

let page = null;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 700));
  try {
    const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
    page = targets.find((t) => t.type === 'page');
    if (page) break;
  } catch {}
}
if (!page) throw new Error('no page target on port ' + port);

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
const sample = (img, fx, fy) => {
  const x = Math.min(img.width - 1, Math.max(0, Math.round(fx * img.width)));
  const y = Math.min(img.height - 1, Math.max(0, Math.round(fy * img.height)));
  const i = y * img.stride + x * 3;
  const lum = Math.round(0.2126 * img.px[i] + 0.7152 * img.px[i + 1] + 0.0722 * img.px[i + 2]);
  return { x, y, r: img.px[i], g: img.px[i + 1], b: img.px[i + 2], lum };
};

await handshake;
await send('Runtime.enable');
await send('Page.enable');
await new Promise((r) => setTimeout(r, 6000));

const report = await evalJs(`JSON.stringify({
  title: document.title,
  card: document.querySelector('.boot-title')?.textContent ?? null,
  sub: document.querySelector('.boot-sub')?.textContent ?? null,
  sora: document.fonts.check('16px Sora'),
  mono: document.fonts.check('12px "IBM Plex Mono"'),
  bg: getComputedStyle(document.body).backgroundColor,
  viewport: window.innerWidth + 'x' + window.innerHeight
})`);
console.log('boot report:', report);

const shot = await send('Page.captureScreenshot', { format: 'png' });
if (!shot?.data) throw new Error('no screenshot data');
fs.writeFileSync(root + '\\sandbox\\boot.png', Buffer.from(shot.data, 'base64'));
const img = decode(Buffer.from(shot.data, 'base64'));
console.log('capture:', img.width, 'x', img.height);
for (const [fx, fy, label] of [[0.02, 0.02, 'corner TL'], [0.98, 0.02, 'corner TR'], [0.02, 0.98, 'corner BL'], [0.98, 0.98, 'corner BR'], [0.5, 0.5, 'center']]) {
  const s = sample(img, fx, fy);
  console.log(`${label}: rgb(${s.r},${s.g},${s.b}) lum=${s.lum} @ ${s.x},${s.y}`);
}

console.log('--- captured errors ---');
console.log(errors.join('\n---\n') || 'none');
process.exit(0);
