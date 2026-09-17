const targets = await fetch('http://127.0.0.1:9222/json').then((r) => r.json());
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('no page target');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = () => rej(new Error('ws error'));
});

let nextId = 1;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id !== undefined && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) rej(new Error(JSON.stringify(msg.error)));
    else res(msg.result);
  }
};

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}

const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result?.value;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Page.enable');
await send('Page.reload');
await sleep(2800);

for (let i = 0; i < 60; i++) {
  const ready = await evalJs(`window.__playlistRiver !== undefined && window.__songActions !== undefined && window.__songActions.libraryTracks().length > 0 && window.__songActions.playlistsReady()`);
  if (ready) break;
  await sleep(500);
}

const plId = await evalJs(`(async () => {
  const A = window.__songActions;
  for (const pl of A.playlists().filter((x) => x.name === '__diag_settle')) await A.removePlaylist(pl.id);
  const lib = A.libraryTracks().filter((t) => t.artFile !== null).slice(0, 10);
  if (lib.length < 10) return null;
  await A.createPlaylistWithTrack('__diag_settle', lib[0]);
  const pl = A.playlists().find((p) => p.name === '__diag_settle');
  if (pl === undefined) return null;
  for (const t of lib.slice(1)) await A.fileIntoPlaylist(pl.id, t);
  return A.playlists().find((p) => p.id === pl.id).tracks.length === 10 ? pl.id : null;
})()`);
if (plId === null) {
  console.log('could not seed playlist');
  process.exit(1);
}
console.log(`seeded __diag_settle with 10 tracks`);

await evalJs(`window.__playlistRiver.open('${plId}')`);
await sleep(1200);

for (let i = 0; i < 10; i++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 960, y: 500, deltaX: 0, deltaY: -120 });
  await sleep(70);
}
await sleep(900);

const dragState = await evalJs(`(() => {
  const cards = [...document.querySelectorAll('#playlist-river .rv2-card')]
    .map((c) => { const r = c.getBoundingClientRect(); return { i: +c.dataset.index, id: c.dataset.id, x: r.left + r.width / 2, y: r.top + r.height / 2, vis: getComputedStyle(c).visibility, op: +getComputedStyle(c).opacity }; })
    .filter((c) => c.vis === 'visible' && c.op > 0.5);
      const source = cards.reduce((a, b) => (b.y > a.y ? b : a), cards[0]);
      const sorted = [...cards].sort((a, b) => a.y - b.y);
      const sIdx = sorted.findIndex((c) => c.i === source.i);
      const above = sorted[sIdx - 1];
      return { from: source.i, id: source.id, displacedId: above ? above.id : null, x: source.x, y: source.y, targetY: source.y - 520, orderBefore: window.__playlistRiver.ids() };
    })()`);
    console.log(`dragging idx ${dragState.from} up; displaced neighbor = ${String(dragState.displacedId).slice(0, 12)}`);

await evalJs(`(() => {
  window.__sp = { frames: [], dragged: '${dragState.id}', displaced: '${dragState.displacedId ?? ''}', err: [] };
  window.addEventListener('error', (e) => window.__sp.err.push('error: ' + String(e.message)));
  window.addEventListener('unhandledrejection', (e) => window.__sp.err.push('rejection: ' + String(e.reason)));
  window.__sp.start = () => {
    const read = (id) => {
      const c = document.querySelector('#playlist-river .rv2-card[data-id="' + id + '"]');
      if (c === null) return null;
      const r = c.getBoundingClientRect();
      return { y: Math.round((r.top + r.height / 2) * 10) / 10, w: Math.round(r.width * 10) / 10, op: +getComputedStyle(c).opacity, z: c.style.zIndex };
    };
    const loop = () => {
      try {
        window.__sp.frames.push({
          t: Math.round(performance.now()),
          d: read(window.__sp.dragged),
          p: window.__sp.displaced ? read(window.__sp.displaced) : null,
          pos: window.__playlistRiver ? +window.__playlistRiver.scroll().toFixed(2) : null,
        });
      } catch (err) {
        window.__sp.err.push('frame: ' + String(err));
      }
      if (window.__sp.frames.length < 280) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return true;
  };
  return true;
})()`);

await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(dragState.x), y: Math.round(dragState.y), button: 'left', clickCount: 1 });
let engaged = true;
for (let s = 1; s <= 16; s++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(dragState.x), y: Math.round(dragState.y + ((dragState.targetY - dragState.y) * s) / 16), button: 'left' });
  await sleep(40);
  if (s === 4) {
    engaged = await evalJs(`document.querySelector('#playlist-river .rv2-card[data-id="' + window.__sp.dragged + '"]')?.style.zIndex === '90'`);
    if (!engaged) {
      console.log('drag never engaged — aborting');
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(dragState.x), y: Math.round(dragState.targetY), button: 'left', clickCount: 1 });
      process.exit(2);
    }
  }
}
const releaseT = await evalJs(`(async () => {
  window.__sp.frames = [];
  window.__sp.start();
  return performance.now();
})()`);
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(dragState.x), y: Math.round(dragState.targetY), button: 'left', clickCount: 1 });
await sleep(1800);

const frames = await evalJs(`window.__sp.frames`);
const post = frames.filter((f) => f.t >= releaseT);
console.log(`release at t=${Math.round(releaseT)}; ${post.length} post-release frames`);

const report = (label, key) => {
  let prev = null;
  let maxDy = 0;
  let maxDyAt = 0;
  let maxDw = 0;
  let maxDwAt = 0;
  let lateMoveFrames = 0;
  for (const f of post) {
    const cur = f[key];
    if (prev !== null && prev !== undefined && cur !== null && prev !== null) {
      const dy = Math.abs(cur.y - prev.y);
      const dw = Math.abs(cur.w - prev.w);
      if (dy > maxDy) {
        maxDy = dy;
        maxDyAt = f.t - Math.round(releaseT);
      }
      if (dw > maxDw) {
        maxDw = dw;
        maxDwAt = f.t - Math.round(releaseT);
      }
      if (f.t - Math.round(releaseT) > 700 && dy > 8) lateMoveFrames++;
    }
    prev = cur;
  }
  console.log(`${label}: max frame move ${maxDy}px at +${maxDyAt}ms; max frame resize ${maxDw}px at +${maxDwAt}ms; late moves (>700ms, >8px): ${lateMoveFrames}`);
};

report('dragged card ', 'd');
report('displaced card', 'p');

const displaced = post.map((f) => ({ dt: f.t - Math.round(releaseT), y: f.p ? f.p.y : null, op: f.p ? f.p.op : null }));
console.log('dragged card timeline (every 4th frame):');
for (let i = 0; i < post.length; i += 4) {
  const f = post[i];
  console.log(`  +${String(f.t - Math.round(releaseT)).padStart(5)}ms  dy=${f.d ? f.d.y : 'gone'}  z=${f.d ? f.d.z : '-'}  pos=${f.pos}`);
}
const samples = [0, 100, 200, 300, 400, 500, 600, 700, 800, 1000, 1200].map((ms) => {
  const f = displaced.filter((r) => r.dt >= ms)[0];
  return { ms, y: f ? f.y : null, op: f ? f.op : null };
});
console.log('displaced card timeline:');
for (const s of samples) console.log(`  +${String(s.ms).padStart(4)}ms  y=${s.y}  op=${s.op}`);

const stateDump = await evalJs(`(() => {
  const cards = [...document.querySelectorAll('#playlist-river .rv2-card')];
  const gone = window.__sp.displaced ? cards.every((c) => c.dataset.id !== window.__sp.displaced) : false;
  return {
    open: window.__playlistRiver.isOpen(),
    pos: window.__playlistRiver.scroll(),
    cardCount: cards.length,
    displacedGone: gone,
    displacedPresent: window.__sp.displaced ? document.querySelector('#playlist-river .rv2-card[data-id="' + window.__sp.displaced + '"]') !== null : null,
    ids: window.__playlistRiver.ids().slice(0, 12),
    riverDisplay: getComputedStyle(document.querySelector('#playlist-river')).display,
  };
})()`);
console.log('state at end:', JSON.stringify(stateDump, null, 1));
const orderAfter = await evalJs(`window.__playlistRiver.ids()`);
const moved = JSON.stringify(orderAfter) !== JSON.stringify(dragState.orderBefore);
console.log(`commit: ${moved ? 'yes, order changed' : 'NO — order unchanged (drag did not cross)'}`);
const errs = await evalJs(`window.__sp.err`);
console.log(`page errors during run: ${errs.length === 0 ? 'none' : ''}`);
for (const e of errs) console.log(`  ${e}`);

const cleanup = await evalJs(`(async () => {
  const A = window.__songActions;
  const pl = A.playlists().find((p) => p.name === '__diag_settle');
  if (pl !== undefined) await A.removePlaylist(pl.id);
  return true;
})()`);

ws.close();
process.exit(0);
