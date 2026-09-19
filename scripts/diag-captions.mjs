const targets = await fetch('http://127.0.0.1:9222/json').then((r) => r.json());
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('no page target');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
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
const send = (method, params = {}) => {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
};
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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

await send('Page.enable');
await send('Page.reload');
await sleep(3200);
await evalJs(`document.querySelector('#mode-tabs button[data-mode="shelf"]')?.click()`);
await sleep(900);
await evalJs(`[...document.querySelectorAll('#shelf-lens button')].find((b) => b.textContent === 'Playlists')?.click()`);
await sleep(900);

// seed: playlist with two songs so one can be removed
await evalJs(`(async () => {
  const A = window.__songActions;
  for (const x of A.playlists().filter((p) => p.name === '__diag_cap')) await A.removePlaylist(x.id);
  const lib = A.libraryTracks();
  await A.createPlaylistWithTrack('__diag_cap', lib[0]);
  const pl = A.playlists().find((p) => p.name === '__diag_cap');
  await A.fileIntoPlaylist(pl.id, lib[1]);
})()`);
await sleep(700);

// sampler: per visible card -> face center x, caption center x, caption opacity, ledger text
await evalJs(`(() => {
  window.__cap = [];
  const step = () => {
    const cards = [...document.querySelectorAll('#shelf .shelf-card')];
    const names = window.__shelf.names();
    const center = window.__shelf.center();
    const rec = {
      t: Math.round(performance.now()),
      center: center >= 0 && center < names.length ? names[center] : '(plus)',
      cards: cards.map((c) => {
        const f = c.querySelector('.shelf-face');
        const cap = c.querySelector('.shelf-caption');
        const led = c.querySelector('.shelf-ledger');
        if (f === null || cap === null || led === null) return null;
        const fr = f.getBoundingClientRect();
        const cr = cap.getBoundingClientRect();
        return {
          id: c.getAttribute('data-id'),
          ft: (f.style.transform || '').slice(0, 60),
          ct: (cap.style.transform || '').slice(0, 60),
          fx: Math.round((fr.left + fr.width / 2) * 10) / 10,
          cx: Math.round((cr.left + cr.width / 2) * 10) / 10,
          co: (() => { const o = getComputedStyle(cap).opacity; return Math.round(Number(o) * 100) / 100; })(),
          lx: Math.round((led.getBoundingClientRect().left + led.getBoundingClientRect().width / 2) * 10) / 10,
          lw: Math.round(led.getBoundingClientRect().width * 10) / 10,
          vis: fr.width > 40,
        };
      }).filter((x) => x !== null),
    };
    window.__cap.push(rec);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
})()`);

const pull = async (label, from) => {
  const raw = await evalJs(`window.__cap.filter((f) => f.t >= ${from})`);
  const bad = [];
  let prevT = 0;
  for (const f of raw) {
    if (f.t - prevT > 120) console.log(`  [${label}] gap ${prevT}..${f.t}`);
    prevT = f.t;
    for (const c of f.cards) {
      if (!c.vis) continue;
      if (c.co > 0.3 && Math.abs(c.cx - c.fx) > 4) bad.push({ t: f.t, id: c.id, what: 'caption', off: Math.round((c.cx - c.fx) * 10) / 10 });
      if (c.co > 0.3 && c.lw > 4 && Math.abs(c.lx - c.fx) > 60) bad.push({ t: f.t, id: c.id, what: 'ledger', off: Math.round((c.lx - c.fx) * 10) / 10, w: c.lw });
    }
  }
  const uniqOffsets = [...new Set(bad.map((b) => b.off))];
  console.log(`${label}: ${raw.length} frames, offset frames: ${bad.length}${bad.length > 0 ? ` offsets: ${JSON.stringify(uniqOffsets)}` : ''}`);
  if (bad.length > 0) {
    const peak = bad.reduce((a, b) => (Math.abs(b.off) > Math.abs(a.off) ? b : a), bad[0]);
    const frame = raw.find((f) => f.t === peak.t);
    const card = frame !== undefined ? frame.cards.find((x) => x.id === peak.id) : null;
    if (card !== null && card !== undefined) {
      console.log("  peak transforms:", JSON.stringify({ ft: card.ft, ct: card.ct, fx: card.fx, cx: card.cx }));
    }
    const first = bad[0];
    const last = bad[bad.length - 1];
    console.log(`  offset window: ${first.t}..${last.t} (${last.t - first.t}ms) example: ${JSON.stringify(first)}`);
  }
  return bad.length;
};

// SCENARIO A: open the playlist river, remove a song, esc, watch captions
console.log('--- A: remove a song, then Esc the river ---');
const openPt = await evalJs(`(() => {
  const pl = window.__songActions.playlists().find((p) => p.name === '__diag_cap');
  const idx = window.__shelf.entries().findIndex((e) => e.ref === pl.id);
  window.__shelf.goto(idx);
  return 'goto';
})()`);
await sleep(1200);
await realClick(await evalJs(`(() => {
  const pl = window.__songActions.playlists().find((p) => p.name === '__diag_cap');
  const el = document.querySelector('#shelf .shelf-card[data-id="playlist:' + pl.id + '"]');
  if (el === null) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`));
await sleep(2200);
// inside the river: right-click the centered card -> Remove from playlist
const cardPt = await evalJs(`(() => {
  const el = document.querySelector('#playlist-river .rv2-card:not(.rv2-ghost)');
  if (el === null) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`);
await realRight(cardPt);
await sleep(600);
await evalJs(`(() => {
  const b = Array.from(document.querySelectorAll('.sm-fork-btn')).find((x) => x.textContent === 'Remove from playlist');
  if (b !== undefined) b.click();
})()`);
await sleep(1600);
const escT = await evalJs(`Math.round(performance.now())`);
await escape();
await sleep(3200);
const a1 = await pull('A captions', escT - 300);

// SCENARIO B: file a song (Added), watch caption opacity through the quit
console.log('--- B: file a song, quit ---');
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
await evalJs(`window.__shelf.goto(window.__shelf.entries().findIndex((e) => e.id === 'playlist:' + window.__songActions.playlists().find((p) => p.name === '__diag_cap').id))`);
await sleep(1100);
await evalJs(`window.__cap = []`);
const clickT = await evalJs(`Math.round(performance.now())`);
await realClick(await evalJs(`(() => {
  const pl = window.__songActions.playlists().find((p) => p.name === '__diag_cap');
  const el = document.querySelector('#shelf .shelf-card[data-id="playlist:' + pl.id + '"]');
  if (el === null) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`));
await sleep(4500);
{
  const raw = await evalJs(`window.__cap.filter((f) => f.t >= ${clickT})`);
  const dips = [];
  let prev = null;
  for (const f of raw) {
    for (const c of f.cards) {
      if (!c.vis) continue;
      if (prev !== null && prev.co >= 0.9 && c.co <= 0.6) dips.push({ t: f.t, id: c.id, from: prev.co, to: c.co });
    }
    prev = f;
    break; // track only the centered card region is hard; sample first visible card is wrong - handled below
  }
  // better: per-card opacity timeline
  const byCard = {};
  for (const f of raw) for (const c of f.cards) {
    if (!c.vis) continue;
    (byCard[c.id] ??= []).push({ t: f.t, co: c.co });
  }
  const flashCards = [];
  for (const [id, tl] of Object.entries(byCard)) {
    for (let i = 1; i < tl.length; i++) {
      if (tl[i - 1].co >= 0.85 && tl[i].co <= 0.6) { flashCards.push(id); break; }
    }
  }
  console.log(`B: ${raw.length} frames; cards with opacity dip (fade-out-then-in): ${flashCards.length} ${JSON.stringify(flashCards)}`);
}

// cleanup
await evalJs(`window.__songActions.removePlaylist((window.__songActions.playlists().find((p) => p.name === '__diag_cap') ?? { id: '' }).id)`);
console.log('done');
ws.close();
process.exit(0);
