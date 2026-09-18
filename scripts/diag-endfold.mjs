import net from 'node:net';
import crypto from 'node:crypto';

const targets = await fetch('http://127.0.0.1:9222/json').then((r) => r.json());
const page = targets.find((t) => t.type === 'page');
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
        const { res } = pending.get(msg.id);
        pending.delete(msg.id);
        res(msg.result);
      }
    }
  }
});
await new Promise((r) => { const t = setInterval(() => { if (upgraded) { clearInterval(t); r(); } }, 20); });
const send = (method, params = {}) => {
  const id = nextId++;
  const data = Buffer.from(JSON.stringify({ id, method, params }));
  const mask = crypto.randomBytes(4);
  let h;
  if (data.length < 126) { h = Buffer.alloc(2); h[0] = 0x81; h[1] = 0x80 | data.length; }
  else { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0x80 | 126; h.writeUInt16BE(data.length, 2); }
  const m = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) m[i] = data[i] ^ mask[i % 4];
  socket.write(Buffer.concat([h, mask, m]));
  return new Promise((res) => pending.set(id, { res }));
};
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __err: JSON.stringify(r.exceptionDetails) };
  return r.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const readCards = (rootId) => evalJs(`(() => {
  const regionH = window.innerHeight - 52 - 62;
  const slot = regionH / 7;
  const mid = 52 + regionH / 2;
  return [...document.querySelectorAll('#${rootId} .rv2-card')]
    .map((el) => {
      const r = el.getBoundingClientRect();
      const m = el.style.transform.match(/rotateX\\(([-0-9.]+)deg\\) scale\\(([-0-9.]+)\\)/);
      return {
        i: Number(el.dataset.index),
        dy: Math.round((r.top + r.height / 2) - mid),
        h: Math.round(r.height),
        tilt: m ? Number(m[1]) : null,
        scale: m ? Number(m[2]) : null,
        vis: getComputedStyle(el).visibility,
      };
    })
    .filter((c) => c.vis !== 'hidden')
    .sort((a, b) => a.i - b.i)
    .map((c) => ({ ...c, steps: (c.dy / slot).toFixed(2) }));
})()`);

await send('Page.enable');
await send('Page.reload');
await sleep(3000);
for (let i = 0; i < 15; i++) {
  const ready = await evalJs(`window.__songActions !== undefined && window.__songActions.libraryTracks().length > 0 && window.__playlistRiver !== undefined`);
  if (ready) break;
  await sleep(700);
}

console.log('=== SONGS RIVER (mid-list reference) ===');
const songs = await readCards('river-v2');
console.log(JSON.stringify(songs, null, 1));

const testId = await evalJs(`(() => {
  const pl = window.__songActions.playlists().find((p) => p.name === 'test');
  return pl?.id ?? null;
})()`);
console.log(`test playlist: ${testId}`);
if (testId !== null) {
  await evalJs(`window.__playlistRiver.open(${JSON.stringify(testId)})`);
  await sleep(1400);
  console.log('=== PLAYLIST "test" AT REST (anchor at first song) ===');
  console.log(JSON.stringify(await readCards('playlist-river'), null, 1));

  await evalJs(`window.__playlistRiver.close()`);
  await sleep(900);
}

socket.end();
