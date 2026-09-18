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
const exceptions = [];
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
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        exceptions.push({ text: d.text, stack: d.exception?.description ?? d.stackTrace?.callFrames?.map((f) => `${f.functionName || '?'} @${f.url}:${f.lineNumber}`).join('\n') ?? '' });
      } else if (msg.id !== undefined && pending.has(msg.id)) {
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
const realClick = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
};

await send('Runtime.enable');
await send('Page.enable');
await send('Page.reload');
await sleep(3000);

for (let i = 0; i < 15; i++) {
  const ready = await evalJs(`window.__songActions !== undefined && window.__songActions.libraryTracks().length > 0 && window.__queueRiver !== undefined`);
  if (ready) break;
  await sleep(700);
}
for (let i = 0; i < 10; i++) {
  const a = await evalJs(`JSON.stringify(window.__songActions.queueSnapshot())`);
  await sleep(400);
  const b = await evalJs(`JSON.stringify(window.__songActions.queueSnapshot())`);
  if (a === b) break;
}

const seeded = await evalJs(`(() => {
  const A = window.__songActions;
  const lib = A.libraryTracks();
  const out = [];
  const albums = new Set();
  for (const t of lib) { const a = t.album ?? ''; if (albums.has(a)) continue; albums.add(a); out.push(t); if (out.length === 4) break; }
  A.setContext(out, 0);
  return out.map((t) => t.id);
})()`);
await sleep(600);
console.log(`seeded: ${JSON.stringify(seeded)}`);

await evalJs(`window.__queueRiver.open()`);
await sleep(900);

const before = await evalJs(`(() => ({ ids: window.__queueRiver.ids(), center: window.__queueRiver.centerId(), snap: window.__songActions.queueSnapshot() }))()`);
console.log(`before drag: ${JSON.stringify(before)}`);

const drag = async (id, dy, steps = 12) => {
  const spot = await evalJs(`(() => {
    const el = [...document.querySelectorAll('#queue-river .rv2-card')].find((c) => c.dataset.id === ${JSON.stringify(id)});
    if (el === undefined) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (spot === null) return console.log(`card ${id} not found`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(spot.x), y: Math.round(spot.y), button: 'left', clickCount: 1 });
  for (let s = 1; s <= steps; s++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(spot.x), y: Math.round(spot.y + (dy * s) / steps), button: 'left' });
    await sleep(40);
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(spot.x), y: Math.round(spot.y + dy), button: 'left' });
  await sleep(1300);
};

console.log('--- drag C (third card) up to next-up (two slots up) ---');
await drag(seeded[3], -290);
console.log(`after drag-up: ${JSON.stringify(await evalJs(`({ ids: window.__queueRiver.ids(), snap: window.__songActions.queueSnapshot() })`))}`);

console.log('--- drag B (next-up) down one, then back up to next-up ---');
await drag(seeded[2], 150);
await drag(seeded[2], -150);
console.log(`after round trip: ${JSON.stringify(await evalJs(`({ ids: window.__queueRiver.ids(), snap: window.__songActions.queueSnapshot() })`))}`);

console.log('--- drag next-up up beyond the top of the span (gap clamps at span start) ---');
await drag(seeded[1], -220);
console.log(`after clamp drag: ${JSON.stringify(await evalJs(`({ ids: window.__queueRiver.ids(), snap: window.__songActions.queueSnapshot() })`))}`);

console.log('--- click lifecycle of a jump-play card ---');
const clickProbe = await evalJs(`(() => {
  const el = [...document.querySelectorAll('#queue-river .rv2-card')].find((c) => !c.classList.contains('rv2-ghost') && c.dataset.id !== window.__queueRiver.centerId());
  if (el === undefined) return null;
  const r = el.getBoundingClientRect();
  return { id: el.dataset.id, x: r.left + r.width / 2, y: r.top + r.height / 2, willVanish: 'observe' };
})()`);
if (clickProbe !== null) {
  const frameAfterFrame = [];
  await send('Runtime.evaluate', { expression: `
    window.__clickTrace = { id: ${JSON.stringify(clickProbe.id)}, frames: [] };
    const el = [...document.querySelectorAll('#queue-river .rv2-card')].find((c) => c.dataset.id === ${JSON.stringify(clickProbe.id)});
    let n = 0;
    const tick = () => {
      const e = [...document.querySelectorAll('#queue-river .rv2-card')].find((c) => c.dataset.id === ${JSON.stringify(clickProbe.id)});
      window.__clickTrace.frames.push(e ? { inDom: true, op: Number(getComputedStyle(e).opacity) } : { inDom: false });
      if (++n < 40) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  ` });
  await realClick(clickProbe.x, clickProbe.y);
  await sleep(1600);
  const trace = await evalJs(`window.__clickTrace`);
  console.log(`click trace for ${trace.id}: first 12 frames = ${JSON.stringify(trace.frames.slice(0, 12))}`);
  console.log(`queue after click: ${JSON.stringify(await evalJs(`({ snap: window.__songActions.queueSnapshot(), ids: window.__queueRiver.ids(), ghosts: window.__queueRiver.ghostIds(), center: window.__queueRiver.centerId(), title: document.title })`))}`);
}

console.log(`exceptions: ${exceptions.length}`);
for (const e of exceptions) console.log(`EXCEPTION: ${e.text}\n${e.stack}`);
socket.end();
