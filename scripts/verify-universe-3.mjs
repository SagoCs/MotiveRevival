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
    const b0 = buf[0];
    const opcode = b0 & 0x0f;
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
await sleep(1200);
const before = await evalJs(`document.querySelector('#mode-tabs button.active')?.dataset.mode ?? 'none'`);
await evalJs(`document.querySelector('.uni-hole')?.click()`);
await sleep(900);
const after = await evalJs(`({
  mode: document.querySelector('#mode-tabs button.active')?.dataset.mode ?? 'none',
  songsVisible: !document.querySelector('#carousel')?.hidden,
})`);
console.log('hole-click:', before, '->', JSON.stringify(after));
process.exit(0);
