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
await sleep(3200);

const ready = await evalJs(`window.__shelf !== undefined && window.__songActions.libraryTracks().length > 0`);
if (!ready) {
  console.log('not ready');
  process.exit(1);
}

await evalJs(`window.__diagSamples = []`);
await evalJs(`(() => {
  const step = () => {
    const cards = [...document.querySelectorAll('#shelf .shelf-card')];
    const names = window.__shelf.names();
    const center = window.__shelf.center();
    window.__diagSamples.push({
      t: Math.round(performance.now()),
      xs: cards.map((c) => {
        const f = c.querySelector('.shelf-face');
        const r = f.getBoundingClientRect();
        return Math.round((r.left + r.width / 2) * 10) / 10;
      }),
      center: center >= 0 && center < names.length ? names[center] : '(plus)',
      n: cards.length,
    });
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
})()`);

const segments = (label, minStill = 260) => {
  const raw = s || [];
  const frames = raw.filter((f) => f !== null);
  const out = [];
  let seg = null;
  for (let i = 1; i < frames.length; i++) {
    let d = 0;
    for (let k = 0; k < Math.min(frames[i].xs.length, frames[i - 1].xs.length); k++) {
      d = Math.max(d, Math.abs(frames[i].xs[k] - frames[i - 1].xs[k]));
    }
    const dt = frames[i].t - frames[i - 1].t;
    const moving = d > 0.6 && dt < 100;
    const moved = frames[i].center !== frames[i - 1].center;
    if (moving || moved) {
      if (seg === null) seg = { start: frames[i - 1].t, end: frames[i].t, maxD: d, centers: [frames[i - 1].center, frames[i].center] };
      else { seg.end = frames[i].t; seg.maxD = Math.max(seg.maxD, d); seg.centers.push(frames[i].center); }
    } else if (seg !== null && frames[i].t - seg.end > minStill) {
      out.push(seg);
      seg = null;
    }
  }
  if (seg !== null) out.push(seg);
  console.log(`${label}: ${out.length} motion segment(s)`);
  out.forEach((g, i) => {
    const uniq = [...new Set(g.centers)];
    console.log(`  seg${i + 1}: ${g.start}..${g.end}ms (${g.end - g.start}ms, maxD ${g.maxD.toFixed(1)}px) centers: ${uniq.join(' -> ')}`);
  });
  return out;
};

const realClick = async (pt) => {
  if (pt === null) return;
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
};
const realRight = async (pt) => {
  if (pt === null) return;
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'right', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'right', clickCount: 1 });
};
const escape = () => evalJs(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);

await evalJs(`document.querySelector('#mode-tabs button[data-mode="shelf"]')?.click()`);
await sleep(900);
await evalJs(`[...document.querySelectorAll('#shelf-lens button')].find((b) => b.textContent === 'Playlists')?.click()`);
await sleep(900);

const seed = await evalJs(`(async () => {
  const A = window.__songActions;
  await A.removePlaylist((A.playlists().find((p) => p.name === '__diag_pl') ?? { id: '' }).id);
  await A.createPlaylistWithTrack('__diag_pl', A.libraryTracks()[0]);
  return A.playlists().find((p) => p.name === '__diag_pl').id;
})()`);
await sleep(700);

const gotoSquare = async (name) => {
  const idx = await evalJs(`window.__shelf.entries().findIndex((e) => e.name === ${JSON.stringify(name)})`);
  await evalJs(`window.__shelf.goto(${idx})`);
  await sleep(1100);
  return await evalJs(`(() => {
    const pl = window.__songActions.playlists().find((p) => p.name === ${JSON.stringify(name)});
    const el = pl === undefined ? null : document.querySelector('#shelf .shelf-card[data-id="playlist:' + pl.id + '"]');
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
};

// S1: scene -> Esc
console.log('--- S1: scene open, Esc ---');
await evalJs(`window.__diagSamples = []`);
const pt1 = await gotoSquare('__diag_pl');
await realRight(pt1);
await sleep(1400);
await escape();
await sleep(2400);
{
  const raw = await evalJs(`window.__diagSamples`);
  globalThis.s = raw;
  segments('S1 scene->Esc');
}

// S2: scene -> Delete
console.log('--- S2: scene open, Delete ---');
await evalJs(`window.__diagSamples = []`);
const pt2 = await gotoSquare('__diag_pl');
await realRight(pt2);
await sleep(1400);
await evalJs(`(() => {
  const d = [...document.querySelectorAll('.shelf-manage-opt')].find((b) => b.textContent === 'Delete' || b.textContent === 'Confirm?');
  if (d !== undefined) d.click();
})()`);
await sleep(3500);
{
  const raw = await evalJs(`window.__diagSamples`);
  globalThis.s = raw;
  segments('S2 scene->Delete');
}

// reseed for S3
await evalJs(`(async () => {
  const A = window.__songActions;
  await A.createPlaylistWithTrack('__diag_pl', A.libraryTracks()[0]);
})()`);
await sleep(700);

// S3: file a song into it (Added), watch the home transition
console.log('--- S3: file a song (Added) ---');
await evalJs(`document.querySelector('#mode-tabs button[data-mode="songs"]')?.click()`);
await sleep(1000);
await evalJs(`(() => {
  const cards = Array.from(document.querySelectorAll('#river-v2 .rv2-card'));
  const tallest = Math.max(...cards.map((c) => c.getBoundingClientRect().height));
  const c = cards.filter((x) => x.getBoundingClientRect().height > tallest * 0.62).sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
  if (c !== undefined) c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
})()`);
await sleep(400);
await evalJs(`(() => {
  const b = Array.from(document.querySelectorAll('.sm-fork-btn')).find((x) => x.textContent === 'Add to playlist');
  if (b !== undefined) b.click();
})()`);
await sleep(900);
await evalJs(`window.__shelf.goto(window.__shelf.entries().findIndex((e) => e.name === '__diag_pl'))`);
await sleep(1100);
await evalJs(`window.__diagSamples = []`);
{
  const plId = await evalJs(`window.__songActions.playlists().find((p) => p.name === '__diag_pl').id`);
  const pt = await evalJs(`(() => {
    const el = document.querySelector('#shelf .shelf-card[data-id="playlist:${plId}"]');
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  await realClick(pt);
  await sleep(4200);
  const raw = await evalJs(`window.__diagSamples`);
  globalThis.s = raw;
  segments('S3 file->Added->home');
}

// S4: playlist river -> Esc (wrong center flash)
console.log('--- S4: playlist river, Esc ---');
await evalJs(`document.querySelector('#mode-tabs button[data-mode="shelf"]')?.click()`);
await sleep(900);
const openPl = await evalJs(`(() => {
  const pl = window.__songActions.playlists().find((p) => p.name === '__diag_pl');
  return window.__playlistRiver.open(pl.id);
})()`);
await sleep(1600);
await evalJs(`window.__diagSamples = []`);
await escape();
await sleep(2800);
{
  const raw = await evalJs(`window.__diagSamples`);
  globalThis.s = raw;
  segments('S4 river->Esc');
}

await evalJs(`window.__songActions.removePlaylist((window.__songActions.playlists().find((p) => p.name === '__diag_pl') ?? { id: '' }).id)`);
console.log('done');
ws.close();
process.exit(0);
