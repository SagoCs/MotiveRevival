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

async function capture() {
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
  return {
    width,
    height,
    lum(x, y) {
      const i = (y * width + x) * 3;
      return 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    },
    rgb(x, y) {
      const i = (y * width + x) * 3;
      return [px[i], px[i + 1], px[i + 2]];
    },
  };
}

function hueOf([r, g, b]) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  if (max === min) return null;
  const d = max - min;
  let h;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return (h + 360) % 360;
}

function hueDist(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

async function parkPointer() {
  const ih = await evalJs('innerHeight');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: ih - 4 });
  await sleep(900);
}

const failures = [];

console.log('title:', await evalJs('document.title'));
await send('Page.reload');
await sleep(2500);
await evalJs(`document.querySelector('#mode-tabs button[data-mode="universe"]')?.click()`);
await sleep(1600);
await parkPointer();

const hook = await evalJs('window.__universeStar ?? null');
console.log('hook:', JSON.stringify(hook));
if (hook === null || hook.drawn !== true || hook.hue === null) failures.push('star not drawn / hook missing');

const innerW = await evalJs('innerWidth');
const scale = (await capture()).width / innerW;

const img1 = await capture();
const sx = Math.round(hook.cx * scale);
const sy = Math.round(hook.cy * scale);
const rCss = Math.max(3, hook.radiusCss);
const rPng = Math.max(3, Math.round(rCss * scale));

let peakLum = 0;
for (let dy = -rPng; dy <= rPng; dy += 1) {
  for (let dx = -rPng; dx <= rPng; dx += 1) {
    const x = Math.min(img1.width - 1, Math.max(0, sx + dx));
    const y = Math.min(img1.height - 1, Math.max(0, sy + dy));
    const l = img1.lum(x, y);
    if (l > peakLum) peakLum = l;
  }
}
console.log(`peak luminance near center: ${peakLum.toFixed(1)} (expect > 80, the MKII suite bar)`);
if (peakLum < 80) failures.push(`star center dark (peak ${peakLum.toFixed(1)})`);

let bestSat = 0;
let bestHue = null;
for (let dy = -2 * rPng; dy <= 2 * rPng; dy += 1) {
  for (let dx = -2 * rPng; dx <= 2 * rPng; dx += 1) {
    const dist = Math.hypot(dx, dy);
    if (dist < rPng * 0.8 || dist > rPng * 2.2) continue;
    const x = Math.min(img1.width - 1, Math.max(0, sx + dx));
    const y = Math.min(img1.height - 1, Math.max(0, sy + dy));
    const [r, g, b] = img1.rgb(x, y);
    const mx = Math.max(r, g, b);
    if (mx === 0) continue;
    const sat = (mx - Math.min(r, g, b)) / mx;
    if (sat > bestSat) {
      bestSat = sat;
      bestHue = hueOf([r, g, b]);
    }
  }
}
const hd = bestHue === null ? 999 : hueDist(bestHue, ((hook.hue % 360) + 360) % 360);
console.log(`body hue: star=${bestHue === null ? '?' : bestHue.toFixed(1)} expected=${(((hook.hue % 360) + 360) % 360).toFixed(1)} dist=${hd.toFixed(1)} (expect <= 20, sat=${bestSat.toFixed(2)})`);
if (hd > 20) failures.push(`hue mismatch (dist ${hd.toFixed(1)})`);
if (bestSat < 0.25) failures.push(`body not saturated (sat ${bestSat.toFixed(2)})`);

let skyMax = 0;
let skyMaxAt = null;
const keepR = rPng * 3.5;
const lanternX = Math.round(4 * scale);
const lanternY = img1.height - Math.round(4 * scale);
const img1b = await (async () => {
  await sleep(1300);
  return capture();
})();
const persists = (x, y) => {
  const inBounds = (img, px, py) => px >= 0 && py >= 0 && px < img.width && py < img.height;
  return inBounds(img1, x, y) && inBounds(img1b, x, y) && img1.lum(x, y) > 60 && img1b.lum(x, y) > 60;
};
for (let y = Math.round(72 * scale); y < img1.height - Math.round(190 * scale); y += 2) {
  for (let x = 0; x < img1.width; x += 2) {
    if (Math.hypot(x - sx, y - sy) < keepR) continue;
    if (Math.hypot(x - lanternX, y - lanternY) < Math.round(160 * scale)) continue;
    if (!persists(x, y)) continue;
    const l = img1.lum(x, y);
    if (l > skyMax) {
      skyMax = l;
      skyMaxAt = [x, y];
    }
  }
}
console.log(`persistent bright pixels away from star: ${skyMax.toFixed(1)} at ${JSON.stringify(skyMaxAt)} (expect <= 60)`);
if (skyMax > 60) failures.push(`persistent bright pixels at ${JSON.stringify(skyMaxAt)} (${skyMax.toFixed(1)})`);

const radiusBefore = hook.radiusCss;
await evalJs(`(() => {
  const u = document.querySelector('#universe');
  const r = u.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`).then(async (center) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: center.x, y: center.y, deltaX: 0, deltaY: -240 });
});
await sleep(800);
await parkPointer();
const hook2 = await evalJs('window.__universeStar ?? null');
console.log(`zoom: radius ${radiusBefore?.toFixed(1)} -> ${hook2?.radiusCss?.toFixed(1)} (expect >= 1.4x)`);
if (!(hook2 && hook2.radiusCss >= radiusBefore * 1.4)) failures.push('zoom did not grow the star');

const dragFrom = { x: Math.round(innerW * 0.5), y: Math.round((await evalJs('innerHeight')) * 0.5) };
const dragTo = { x: dragFrom.x + 180, y: dragFrom.y + 110 };
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: dragFrom.x, y: dragFrom.y, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dragTo.x, y: dragTo.y, button: 'left' });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dragTo.x, y: dragTo.y, button: 'left', clickCount: 1 });
await sleep(900);
await parkPointer();
const hook3 = await evalJs('window.__universeStar ?? null');
console.log(`drag: center ${Math.round(hook2.cx)},${Math.round(hook2.cy)} -> ${Math.round(hook3.cx)},${Math.round(hook3.cy)} (expect ~+180,+110 css)`);
if (Math.abs(hook3.cx - hook2.cx - 180) > 6 || Math.abs(hook3.cy - hook2.cy - 110) > 6) failures.push('drag did not pan the star');

const img2 = await capture();
const sx2 = Math.round(hook3.cx * scale);
const sy2 = Math.round(hook3.cy * scale);
let peak2 = 0;
for (let dy = -rPng * 2; dy <= rPng * 2; dy += 1) {
  for (let dx = -rPng * 2; dx <= rPng * 2; dx += 1) {
    const x = Math.min(img2.width - 1, Math.max(0, sx2 + dx));
    const y = Math.min(img2.height - 1, Math.max(0, sy2 + dy));
    const l = img2.lum(x, y);
    if (l > peak2) peak2 = l;
  }
}
console.log(`peak luminance at panned center: ${peak2.toFixed(1)} (expect > 120)`);
if (peak2 < 120) failures.push(`star lost after pan (peak ${peak2.toFixed(1)})`);

if (failures.length > 0) {
  console.log('FAIL:', failures.join(' | '));
  process.exit(1);
}
console.log('ONE STAR VERIFIED');
process.exit(0);
