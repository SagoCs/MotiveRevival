import net from 'node:net';
import crypto from 'node:crypto';
import os from 'node:os';
import fs from 'node:fs';

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

const info = await evalJs(`(() => {
  const hole = document.querySelector('.uni-hole').getBoundingClientRect();
  const stars = [...document.querySelectorAll('.uni-star')].slice(0, 3).map((el) => {
    const r = el.getBoundingClientRect();
    return { name: el.dataset.name, x: r.x, y: r.y, w: r.width };
  });
  const sparks = [...document.querySelectorAll('.uni-spark')].map((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el, '::before');
    return {
      x: r.x, y: r.y, w: r.width, h: r.height,
      a: el.style.getPropertyValue('--a'),
      b: el.style.getPropertyValue('--b'),
      filter: cs.filter,
      holeAngle: el.style.getPropertyValue('--hole-angle'),
    };
  });
  const ring = getComputedStyle(document.querySelector('.hole-ring'));
  return {
    hole: { x: hole.x, y: hole.y, w: hole.width, h: hole.height },
    stars,
    sparks,
    ringBg: ring.backgroundImage.slice(0, 120),
  };
})()`);
console.log(JSON.stringify(info, null, 1));

async function snap(clipX, clipY, clipW, clipH, file) {
  const r = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: Math.max(0, clipX), y: Math.max(0, clipY), width: clipW, height: clipH, scale: 3 },
  });
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  console.log('saved', file);
}

await snap(0, 0, 1920, 1080, 'C:\\Users\\rhlin\\AppData\\Local\\Temp\\uni-full.png');
await snap(info.hole.x + info.hole.w / 2 - 130, info.hole.y + info.hole.h / 2 - 130, 260, 260, 'C:\\Users\\rhlin\\AppData\\Local\\Temp\\uni-hole.png');
const st = info.stars?.[0];
if (st) {
  await snap(st.x - 60, st.y - 60, 120, 120, 'C:\\Users\\rhlin\\AppData\\Local\\Temp\\uni-star.png');
}
const sp = info.sparks[0];
if (sp) {
  await snap(sp.x + sp.w / 2 - 45, sp.y + sp.h / 2 - 45, 90, 90, 'C:\\Users\\rhlin\\AppData\\Local\\Temp\\uni-spark.png');
}
process.exit(0);
