import net from 'node:net';
import crypto from 'node:crypto';

const port = process.env.ACTIONS_PORT ?? '9222';
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


let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
  if (!ok) failed++;
};

await send('Page.enable');
await send('Runtime.enable');
for (let i = 0; i < 20; i++) {
  const ready = await evalJs(`!!document.querySelector('#mode-tabs button') && !!document.querySelector('#summon-zone')`);
  if (ready) break;
  await sleep(700);
}

await evalJs(`document.querySelector('#mode-tabs button[data-mode="albums"]').click()`);
await sleep(500);
await evalJs(`document.querySelector('#summon-zone').click()`);
await sleep(400);
await evalJs(`(() => { const i = document.querySelector('#oracle-input'); i.value = 'mili'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await sleep(400);

const pre = await evalJs(`(() => {
  const row = document.querySelector('#oracle-results .kind-song');
  return { mode: document.querySelector('#mode-tabs button.active')?.dataset?.mode, found: row !== null, cls: row?.className ?? '' };
})()`);
check('summon open over Albums with song rows', pre.mode === 'albums' && pre.found === true, JSON.stringify(pre));

await evalJs(`document.querySelector('#oracle-results .kind-song').dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))`);
await sleep(400);
const dwell = await evalJs(`(() => {
  const row = document.querySelector('#oracle-results .kind-song');
  return { pending: row.classList.contains('preview-pending') };
})()`);
check('dwell marks the row as preview-pending', dwell.pending === true);

await sleep(1400);
const active = await evalJs(`(() => {
  const row = document.querySelector('#oracle-results .kind-song');
  const cs = getComputedStyle(row);
  return { previewing: row.classList.contains('previewing'), shadow: cs.boxShadow !== 'none', shadowVal: cs.boxShadow.slice(0, 60) };
})()`);
check('preview engages after dwell (on non-Songs tab)', active.previewing === true, JSON.stringify(active));
check('previewing row carries the accent glow', active.shadow === true, active.shadowVal);

await evalJs(`document.querySelector('#oracle-results .kind-song').dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }))`);
await sleep(500);
const cleared = await evalJs(`(() => {
  const row = document.querySelector('#oracle-results .kind-song');
  return { previewing: row.classList.contains('previewing'), shadow: getComputedStyle(row).boxShadow !== 'none' };
})()`);
check('mouseleave clears preview and glow', cleared.previewing === false && cleared.shadow === false, JSON.stringify(cleared));

await evalJs(`document.querySelector('#oracle-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(300);
check('escape closes the summon', await evalJs(`!document.querySelector('#search-oracle').classList.contains('open')`));

console.log(failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
