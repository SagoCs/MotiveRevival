import net from 'node:net';
import crypto from 'node:crypto';

const port = process.env.SWAP_PORT ?? '9222';
setTimeout(() => { console.error('watchdog'); process.exit(2); }, 90000).unref();

let page = null;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 700));
  try {
    const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
    page = targets.find((t) => t.type === 'page');
    if (page) break;
  } catch {}
}
if (!page) throw new Error('no page target');

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
    if (!head.includes(' 101 ')) { console.error('handshake refused'); process.exit(2); }
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
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(JSON.stringify(msg.error)));
        else res(msg.result);
      }
    }
  }
});
await handshake;
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
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result?.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MARKER = `(() => {
  const active = document.querySelector('#mode-tabs button.active')?.dataset?.mode;
  if (active === 'albums') return document.querySelectorAll('.album-card').length > 0;
  if (active === 'artists') return document.querySelectorAll('.artist-card').length > 0;
  if (active === 'playlists') return document.querySelectorAll('.playlist-card').length > 0;
  if (active === 'songs') return document.body.classList.contains('song-river-active') || document.querySelectorAll('.song-row').length > 0;
  return true;
})()`;

async function timedSwap(fromMode, toMode, label) {
  const times = [];
  for (let run = 0; run < 3; run++) {
    await evalJs(`document.querySelector('#mode-tabs button[data-mode="${fromMode}"]').click()`);
    await sleep(900);
    const t = await evalJs(`new Promise((resolve) => {
      const t0 = performance.now();
      document.querySelector('#mode-tabs button[data-mode="${toMode}"]').click();
      const probe = () => {
        const done = (${MARKER});
        if (done || performance.now() - t0 > 2000) resolve(Math.round(performance.now() - t0));
        else requestAnimationFrame(probe);
      };
      requestAnimationFrame(probe);
    })`);
    times.push(t);
    await sleep(500);
  }
  console.log(label.padEnd(28), 'swap-to-content:', times.join(', '), 'ms');
}

await send('Page.enable');
for (let i = 0; i < 20; i++) {
  const ready = await evalJs(`!!document.querySelector('#mode-tabs button')`);
  if (ready) break;
  await sleep(700);
}

await sleep(400);

console.log('--- river surface live on Songs ---');
await evalJs(`document.querySelector('#mode-tabs button[data-mode="songs"]').click()`);
await sleep(700);
await timedSwap('albums', 'artists', 'albums -> artists');
await timedSwap('albums', 'songs', 'albums -> songs');
await timedSwap('songs', 'albums', 'songs -> albums');
await timedSwap('songs', 'artists', 'songs -> artists');
process.exit(0);
