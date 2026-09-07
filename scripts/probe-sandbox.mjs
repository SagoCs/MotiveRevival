import net from 'node:net';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import fs from 'node:fs';
import { spawn, execSync } from 'node:child_process';

const root = 'C:\\Users\\rhlin\\Desktop\\Attempt3\\MotiveRevival';
const port = process.env.SANDBOX_PORT ?? '9223';
setTimeout(() => { console.error('probe watchdog: 120s without finishing'); process.exit(2); }, 120000).unref();

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
const lumAt = (img, x, y) => {
  const xx = Math.min(img.width - 1, Math.max(0, Math.round(x)));
  const yy = Math.min(img.height - 1, Math.max(0, Math.round(y)));
  const i = yy * img.stride + xx * 3;
  return { lum: 0.2126 * img.px[i] + 0.7152 * img.px[i + 1] + 0.0722 * img.px[i + 2], r: img.px[i], g: img.px[i + 1], b: img.px[i + 2] };
};

await handshake;
await send('Runtime.enable');
await send('Page.enable');
await new Promise((r) => setTimeout(r, 5000));
await evalJs('window.__lab && window.__lab.resetView()');

const report = await evalJs(`JSON.stringify({
  title: document.title,
  canvas: (() => { const c = document.querySelector('#lab-canvas'); return c ? c.clientWidth + 'x' + c.clientHeight + ' dev ' + c.width + 'x' + c.height : null; })(),
  lab: window.__lab ? window.__lab.ok : null,
  labVariant: window.__lab ? window.__lab.variant : null,
  labError: window.__lab && window.__lab.error ? window.__lab.error : null
})`);
console.log('boot report:', report);
const lab = JSON.parse(report);
if (!lab.lab) {
  console.log('LAB FAILED TO BOOT, error:', lab.labError);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readMetrics = async () => JSON.parse(await evalJs(`JSON.stringify(window.__lab.metrics())`));
const capture = async () => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  if (!r?.data) throw new Error('no screenshot data');
  return Buffer.from(r.data, 'base64');
};
const shotAt = async (name, expectZoom) => {
  let mNow = await readMetrics();
  const offCenter = Math.abs(mNow.x - 800) > 3 || Math.abs(mNow.y - 450) > 3;
  if (Math.abs(mNow.zoom - expectZoom) > 0.01 || offCenter) {
    console.log(`state race at ${name} (zoom ${mNow.zoom.toFixed(3)}), resetting and retaking`);
    await evalJs(`window.__lab.resetView(); window.__lab.setZoom(${expectZoom})`);
    await sleep(700);
    mNow = await readMetrics();
  }
  const png = await capture();
  fs.writeFileSync(`${root}\\sandbox\\${name}.png`, png);
  return { img: decode(png), m: mNow };
};

const farShot = await shotAt('boot-far', 0.08);
await sleep(500);
console.log('--- far tier (zoom 0.08) ---');
console.log('star center:', JSON.stringify(lumAt(farShot.img, 800, 450)));
console.log('corner:', JSON.stringify(lumAt(farShot.img, 32, 18)));

const midShot = await shotAt('boot-mid', 1.0);
const m = midShot.m;
const sx = m.x;
const sy = m.y;
console.log('--- mid tier (zoom ' + m.zoom.toFixed(2) + ', body ' + Math.round(m.bodyPx) + 'px) ---');
console.log('core:', JSON.stringify(lumAt(midShot.img, sx, sy)));
const ringX = sx + Math.cos(Math.PI / 8) * m.bodyPx * 1.6;
const ringY = sy - Math.sin(Math.PI / 8) * m.bodyPx * 1.6;
console.log('bloom ring 1.6r@22.5deg:', JSON.stringify(lumAt(midShot.img, ringX, ringY)));
console.log('corner:', JSON.stringify(lumAt(midShot.img, 32, 18)));

const closeShot = await shotAt('boot-close', 3.5);
const mc = closeShot.m;
console.log('--- close tier (zoom ' + mc.zoom.toFixed(2) + ', body ' + Math.round(mc.bodyPx) + 'px) ---');
console.log('core:', JSON.stringify(lumAt(closeShot.img, mc.x, mc.y)));
const cx1 = mc.x + Math.cos(Math.PI / 8) * mc.bodyPx * 0.85;
const cy1 = mc.y - Math.sin(Math.PI / 8) * mc.bodyPx * 0.85;
console.log('body mid-edge 0.85r@22.5deg:', JSON.stringify(lumAt(closeShot.img, cx1, cy1)));
const cx2 = mc.x + Math.cos(Math.PI / 8) * mc.bodyPx * 1.5;
const cy2 = mc.y - Math.sin(Math.PI / 8) * mc.bodyPx * 1.5;
console.log('outside 1.5r@22.5deg:', JSON.stringify(lumAt(closeShot.img, cx2, cy2)));

for (const mode of [0, 1, 2]) {
  await evalJs('window.__lab.resetView(); window.__lab.setZoom(1.0)');
  await sleep(300);
  await evalJs(`window.__lab.setParam('bodyMode', ${mode})`);
  await sleep(500);
  await capture();
  await sleep(200);
  await shotAt('boot-body' + mode, 1.0);
  console.log('captured body mode ' + mode);
}

console.log('--- captured errors ---');
console.log(errors.join('\n---\n') || 'none');
process.exit(0);
