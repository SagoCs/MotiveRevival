import net from 'node:net';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const port = process.env.SWAP_PORT ?? '9222';
setTimeout(() => { console.error('probe watchdog: 120s without finishing'); process.exit(2); }, 120000).unref();

let page = null;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 700));
  try {
    const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
    page = targets.find((t) => t.type === 'page');
    if (page) break;
  } catch {}
}
if (!page) throw new Error(`no page target on port ${port}`);

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

const DUMP = `(() => {
  const dump = (sel) => {
    const root = document.querySelector(sel);
    if (root === null) return null;
    const items = [];
    const walk = (el, depth) => {
      const r = el.getBoundingClientRect();
      items.push({
        d: depth,
        tag: el.tagName.toLowerCase(),
        cls: String(el.className ?? '').slice(0, 46),
        x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2),
      });
      for (const c of el.children) walk(c, depth + 1);
    };
    walk(root, 0);
    const cs = getComputedStyle(root);
    const before = getComputedStyle(root, '::before');
    const after = getComputedStyle(root, '::after');
    return {
      rect: { y: +root.getBoundingClientRect().y.toFixed(2), h: +root.getBoundingClientRect().height.toFixed(2) },
      borderTop: cs.borderTopWidth,
      boxSizing: cs.boxSizing,
      beforeContent: before.content, beforeTop: before.top, beforeH: before.height,
      afterContent: after.content, afterTop: after.top, afterH: after.height,
      items,
    };
  };
  return {
    bottomH: getComputedStyle(document.documentElement).getPropertyValue('--bottom-h').trim(),
    dpr: window.devicePixelRatio,
    innerH: window.innerHeight,
    normal: dump('#bottom-bar'),
    expanded: dump('#overlay-bottom'),
    overlayOpen: document.querySelector('#overlay').classList.contains('open'),
  };
})()`;

const describe = (label, data) => {
  console.log('== ' + label + ' ==');
  console.log('  --bottom-h =', data.bottomH, ' dpr =', data.dpr, ' innerH =', data.innerH, ' overlayOpen =', data.overlayOpen);
  for (const key of ['normal', 'expanded']) {
    const d = data[key];
    if (d === null) { console.log('  ' + key + ': MISSING'); continue; }
    console.log('  ' + key + ': y=' + d.rect.y + ' h=' + d.rect.h + ' borderTop=' + d.borderTop + ' box=' + d.boxSizing
      + ' ::before(' + d.beforeContent + ' top=' + d.beforeTop + ' h=' + d.beforeH + ')'
      + ' ::after(' + d.afterContent + ' top=' + d.afterTop + ' h=' + d.afterH + ')');
    for (const it of d.items) {
      if (it.d <= 2) console.log('    ' + '  '.repeat(it.d) + it.tag + '.' + it.cls + '  x=' + it.x + ' y=' + it.y + ' w=' + it.w + ' h=' + it.h);
    }
  }
};

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

async function rowLumas(tag, y0, h) {
  const png = await send('Page.captureScreenshot', { format: 'png', clip: { x: 300, y: y0, width: 1300, height: h, scale: 1 } });
  const img = decode(Buffer.from(png.data, 'base64'));
  const rows = [];
  for (let y = 0; y < img.height; y++) {
    const vals = [];
    for (let x = 0; x < img.width; x++) {
      const o = y * img.stride + x * 3;
      vals.push(0.2126 * img.px[o] + 0.7152 * img.px[o + 1] + 0.0722 * img.px[o + 2]);
    }
    vals.sort((a, b) => a - b);
    rows.push(+vals[Math.floor(vals.length * 0.9)].toFixed(1));
  }
  console.log('  pixels ' + tag + ' y' + y0 + '-' + (y0 + h - 1) + ': ' + rows.join(', '));
}

describe('MEASUREMENT', await evalJs(DUMP));
await send('Page.enable');
await rowLumas('normal ', 1012, 12);

await evalJs(`document.querySelector('#np-open').click()`);
await sleep(900);
describe('AFTER OPENING EXPANDED', await evalJs(DUMP));
await rowLumas('expanded', 1012, 12);

await evalJs(`document.querySelector('#overlay-toggle').click()`);
await sleep(900);
describe('AFTER CLOSING (back to normal)', await evalJs(DUMP));
await rowLumas('closed  ', 1012, 12);

process.exit(0);
