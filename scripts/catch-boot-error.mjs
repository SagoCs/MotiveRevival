import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const child = spawn('cmd', ['/c', 'cd /d C:\\Users\\rhlin\\Desktop\\Attempt3\\MotiveRevival && node_modules\\.bin\\electron.cmd . --remote-debugging-port=9222'], { detached: true, stdio: 'ignore' });
child.unref();

let page = null;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 700));
  try {
    const targets = await fetch('http://127.0.0.1:9222/json').then((r) => r.json());
    page = targets.find((t) => t.type === 'page');
    if (page) break;
  } catch {}
}
if (!page) throw new Error('no page');
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
const errors = [];
socket.on('data', (c) => {
  buf = Buffer.concat([buf, c]);
  if (!up) {
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
socket.on('close', () => { console.log(errors.join('\n') || 'no errors captured'); process.exit(0); });
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
await send('Runtime.enable');
await new Promise((r) => setTimeout(r, 8000));
const stars = await send('Runtime.evaluate', { expression: 'document.querySelectorAll(".uni-star").length', returnByValue: true });
console.log('stars:', JSON.stringify(stars.result?.value));
console.log('--- captured errors ---');
console.log(errors.join('\n---\n') || 'none');
process.exit(0);
