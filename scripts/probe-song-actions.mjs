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
  const ready = await evalJs(`!!window.__songActions && window.__songActions.libraryTracks().length > 0`);
  if (ready) break;
  await sleep(700);
}

const revived = await evalJs(`(async () => {
  const A = window.__songActions;
  if (A.queueSnapshot().upcoming.length > 0) return 'ready';
  document.querySelector('#mode-tabs button[data-mode="songs"]')?.click();
  await new Promise((r) => setTimeout(r, 900));
  const playing = window.__riverV2Lab?.playingId?.() ?? null;
  const cards = Array.from(document.querySelectorAll('.rv2-card'));
  const c = cards.find((x) => x.dataset.id !== playing && x.getBoundingClientRect().height > 60);
  if (c === undefined) return 'no card';
  const r = c.getBoundingClientRect();
  return { tapX: r.left + r.width / 2, tapY: r.top + r.height / 2 };
})()`);
if (revived !== 'ready' && typeof revived === 'object' && revived !== null) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: revived.tapX, y: revived.tapY, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: revived.tapX, y: revived.tapY, button: 'left', clickCount: 1 });
  await sleep(700);
  await evalJs(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(400);
}
const reviveState = await evalJs(`window.__songActions.queueSnapshot().upcoming.length > 0 ? (typeof ${JSON.stringify(revived)} === 'object' ? 'revived' : 'ready') : 'still-empty'`);
check('queue context revived when the session ended at the last track', reviveState === 'ready' || reviveState === 'revived', reviveState);

const QUEUE_TEST = `(() => {
  const A = window.__songActions;
  const before = A.queueSnapshot();
  const scratch = A.libraryTracks().find((t) => t.id === before.upcoming[before.upcoming.length - 1]);
  if (scratch === undefined) return { fatal: 'no upcoming track' };

  const dedupeOutcome = A.queueNext(scratch);

  const removedTail = A.queueRemoveTrack(scratch.id);
  const insert = A.queueNext(scratch);
  const afterInsert = A.queueSnapshot();
  const insertedAtFront = afterInsert.upcoming[0] === scratch.id;
  const dedupeAfterInsert = A.queueNext(scratch);
  const countAfter = afterInsert.upcoming.filter((id) => id === scratch.id).length;

  A.queueMoveToGap(0, 2);
  const afterMove = A.queueSnapshot();
  const movedOk = afterMove.upcoming[1] === scratch.id;
  A.queueMoveToGap(1, 0);
  const afterBack = A.queueSnapshot();
  const backOk = afterBack.upcoming[0] === scratch.id;

  const removed = A.queueRemoveTrack(scratch.id);
  const afterRemove = A.queueSnapshot();
  const restored = afterRemove.ids.length === before.ids.length - 1 && !afterRemove.ids.includes(scratch.id);

  return {
    dedupeOutcome, removedTail, insert: insert, insertedAtFront, dedupeAfterInsert, countAfter,
    movedOk, backOk, removed, restored,
    sizes: { before: before.ids.length, afterInsert: afterInsert.ids.length, end: afterRemove.ids.length },
  };
})()`;

const q = await evalJs(QUEUE_TEST);
if (q === null || q.fatal !== undefined) {
  check('queue test preconditions', false, JSON.stringify(q));
} else {
  check('queueNext pulls a scheduled song to plays-next', q.dedupeOutcome === 'moved', q.dedupeOutcome);
  check('tail removal succeeds', q.removedTail === true);
  check('queueNext inserts as plays-next', q.insert === 'queued' && q.insertedAtFront, JSON.stringify(q));
  check('second queueNext sees it already next (single copy)', q.dedupeAfterInsert === 'alreadyNext' && q.countAfter === 1);
  check('reorder moves the row', q.movedOk);
  check('reorder back restores it', q.backOk);
  check('remove restores the original queue', q.removed && q.restored, JSON.stringify(q.sizes));
}

const p = await evalJs(`(async () => {
  const A = window.__songActions;
  const track = A.libraryTracks().find((t) => t.id === A.queueSnapshot().ids[0]);
  const created = await A.createPlaylistWithTrack('__probe_scratch', track);
  const pl = A.playlists().find((x) => x.name === '__probe_scratch');
  if (pl === undefined) return { created, found: false };
  const contains = A.playlistContains(pl.id, track.id);
  const duplicate = await A.fileIntoPlaylist(pl.id, track);
  await A.removePlaylist(pl.id);
  const gone = A.playlists().every((x) => x.name !== '__probe_scratch');
  return { created, found: true, contains, duplicate, gone };
})()`);
check('create-with-track files the song', p.created === 'added' && p.found === true && p.contains === true, JSON.stringify(p));
check('duplicate file is guarded', p.duplicate === 'alreadyInPlaylist', String(p.duplicate));
check('playlist deletion works (scratch cleaned up)', p.gone === true);

console.log(failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
