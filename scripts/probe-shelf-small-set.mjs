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

const fact = (name, ok, detail = '') => {
  console.log(`${ok ? 'ALIVE' : 'DEAD '}  ${name}${detail ? `  [${detail}]` : ''}`);
};

await send('Page.enable');
await send('Page.reload');
await sleep(2800);

const ready = await evalJs(`window.__shelf !== undefined && window.__songActions !== undefined`);
if (!ready) {
  console.log('app not ready');
  process.exit(1);
}

let libReady = false;
for (let i = 0; i < 60; i++) {
  libReady = await evalJs(`window.__songActions.libraryTracks().length > 0`);
  if (libReady) break;
  await sleep(500);
}
const bootState = await evalJs(`(() => ({
  tracks: window.__songActions.libraryTracks().length,
  playlists: window.__songActions.playlists().map((p) => p.name),
  activeTab: document.querySelector('[data-mode].on')?.getAttribute('data-mode') ?? null,
  shelfTab: document.querySelector('[data-mode="shelf"]') !== null,
  lens: window.__shelf.lens(),
  shelfVisible: window.__shelf.visible(),
}))()`);
console.log(`boot: ${bootState.tracks} tracks, playlists ${JSON.stringify(bootState.playlists)}, tab ${JSON.stringify(bootState.activeTab)}, lens ${JSON.stringify(bootState.lens)}, shelfVisible ${bootState.shelfVisible}`);
if (!libReady) {
  console.log('library never became ready');
  process.exit(1);
}

await evalJs(`document.querySelector('[data-mode="playlists"]')?.click()`);
await sleep(600);
let storeReady = false;
for (let i = 0; i < 20; i++) {
  storeReady = await evalJs(`window.__songActions.playlistsReady()`);
  if (storeReady) break;
  await sleep(300);
}
const plNames = await evalJs(`window.__songActions.playlists().map((p) => p.name)`);
console.log(`playlists store: ready ${storeReady}, ${plNames.length} playlists ${JSON.stringify(plNames)}`);
if (!storeReady || plNames.length < 3) {
  console.log('fewer than 3 playlists; cannot reproduce the report');
  process.exit(1);
}

await evalJs(`document.querySelector('[data-mode="shelf"]')?.click()`);
await sleep(900);
let artistsShown = false;
for (let i = 0; i < 20; i++) {
  artistsShown = await evalJs(`window.__shelf.visible() && window.__shelf.names().length > 0`);
  if (artistsShown) break;
  await sleep(300);
}
await evalJs(`[...document.querySelectorAll('#shelf-lens button')].find((b) => b.textContent === 'Playlists')?.click()`);
await sleep(900);
let lensReady = false;
for (let i = 0; i < 20; i++) {
  lensReady = await evalJs(`window.__shelf.lens() === 'playlists' && window.__shelf.names().length > 0`);
  if (lensReady) break;
  await sleep(300);
}
if (!lensReady) {
  console.log('playlists lens never populated');
  process.exit(1);
}

await evalJs(`(() => {
  window.__smallProbe = { samples: [] };
  return null;
})()`);

const installSampler = evalJs(`(() => {
  window.__smallProbe.start = (frames) => {
    const cards = [...document.querySelectorAll('#shelf .shelf-card')];
    const faces = cards.map((c) => c.querySelector('.shelf-face'));
    window.__smallProbe.cards = cards.map((c) => c.getAttribute('data-id'));
    window.__smallProbe.samples = [];
    let n = 0;
    const step = () => {
      window.__smallProbe.samples.push({
        t: Math.round(performance.now()),
        x: faces.map((f) => {
          const r = f.getBoundingClientRect();
          return Math.round((r.left + r.width / 2) * 10) / 10;
        }),
        sel: document.querySelector('#shelf .shelf-card.selected')?.getAttribute('data-id') ?? null,
        pos: window.__shelf ? +window.__shelf.scroll().toFixed(3) : null,
      });
      if (++n < frames) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    return faces.length;
  };
  return true;
})()`);

const state = await evalJs(`(() => {
  const cards = [...document.querySelectorAll('#shelf .shelf-card')];
  return {
    names: window.__shelf.names(),
    count: cards.length,
    center: window.__shelf.center(),
    pos: window.__shelf.scroll(),
    selected: window.__shelf.selected(),
    centers: cards.map((c) => {
      const f = c.querySelector('.shelf-face');
      const r = f.getBoundingClientRect();
      return Math.round(r.left + r.width / 2);
    }),
    vw: window.innerWidth,
  };
})()`);

console.log(`field: ${state.count} cards, names ${JSON.stringify(state.names)}`);
console.log(`rest: pos ${state.pos.toFixed(2)}, center idx ${state.center}, face centers ${JSON.stringify(state.centers)} (vw ${state.vw})`);

const analyze = (label, samples) => {
  const travels = [];
  const frameMoves = [];
  for (let c = 0; c < (samples[0]?.x.length ?? 0); c++) {
    const col = samples.map((s) => s.x[c]).filter((v) => typeof v === 'number');
    if (col.length === 0) continue;
    travels.push(Math.max(...col) - Math.min(...col));
  }
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1].x;
    const cur = samples[i].x;
    let best = 0;
    for (let c = 0; c < cur.length; c++) {
      const d = Math.abs((cur[c] ?? 0) - (prev[c] ?? 0));
      if (d > best) best = d;
    }
    frameMoves.push(best);
  }
  const posStart = samples[0]?.pos ?? 0;
  const posEnd = samples[samples.length - 1]?.pos ?? 0;
  const posVals = samples.map((s) => s.pos).filter((v) => typeof v === 'number');
  const posMin = posVals.length > 0 ? Math.min(...posVals) : 0;
  const posMax = posVals.length > 0 ? Math.max(...posVals) : 0;
  const selTrace = samples.map((s) => s.sel);
  const firstSel = selTrace.find((v) => v !== null) ?? null;
  const lastSel = selTrace[selTrace.length - 1] ?? null;
  const maxTravel = travels.length > 0 ? Math.max(...travels) : 0;
  const maxFrame = frameMoves.length > 0 ? Math.max(...frameMoves) : 0;
  console.log(`pos ${posStart.toFixed(2)} -> ${posEnd.toFixed(2)} (excursion ${posMin.toFixed(2)} .. ${posMax.toFixed(2)})   rendered travel max ${maxTravel.toFixed(1)}px   max single-frame move ${maxFrame.toFixed(1)}px`);
  console.log(`glow during flight: first ${JSON.stringify(firstSel)} last ${JSON.stringify(lastSel)}`);
  fact(`${label}: position moved`, Math.abs(posEnd - posStart) > 0.05, `${posStart.toFixed(2)} -> ${posEnd.toFixed(2)}`);
  fact(`${label}: pixels moved`, maxTravel > 40, `${maxTravel.toFixed(1)}px total, ${maxFrame.toFixed(1)}px peak/frame`);
  fact(`${label}: no mid-frame teleport`, maxFrame <= Math.max(40, maxTravel * 0.5), `${maxFrame.toFixed(1)}px vs travel ${maxTravel.toFixed(1)}px`);
};

const after = async () => evalJs(`(() => {
  const cards = [...document.querySelectorAll('#shelf .shelf-card')];
  const idx = window.__shelf.center();
  return {
    center: idx,
    centerName: window.__shelf.names()[idx] ?? null,
    selected: window.__shelf.selected(),
    centers: cards.map((c) => {
      const f = c.querySelector('.shelf-face');
      const r = f.getBoundingClientRect();
      return Math.round(r.left + r.width / 2);
    }),
  };
})()`);

console.log('');
console.log('=== TEST 1: wheel ===');
await evalJs(`window.__smallProbe.start(110)`);
for (let i = 0; i < 3; i++) {
  await send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: Math.round(state.vw / 2),
    y: 400,
    deltaX: 0,
    deltaY: 120,
  });
  await sleep(60);
}
await sleep(1800);
const wheelSamples = await evalJs(`window.__smallProbe.samples`);
analyze('wheel', wheelSamples);

console.log('');
console.log('=== TEST 2: arrow key ===');
const namesNow = await evalJs(`window.__shelf.names()`);
const centerBeforeArrow = await evalJs(`window.__shelf.center()`);
const arrowTargetIdx = (centerBeforeArrow + 1) % namesNow.length;
await evalJs(`window.__smallProbe.start(110)`);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
await sleep(1800);
const arrowSamples = await evalJs(`window.__smallProbe.samples`);
const arrowAfter = await after();
analyze('arrow', arrowSamples);
fact('arrow: destination centered after settle', arrowAfter.centerName === namesNow[arrowTargetIdx], `center ${JSON.stringify(arrowAfter.centerName)} expected ${JSON.stringify(namesNow[arrowTargetIdx])}`);

console.log('');
console.log('=== TEST 3: side-card click ===');
const side = await evalJs(`(() => {
  const cards = [...document.querySelectorAll('#shelf .shelf-card')];
  const mid = window.innerWidth / 2;
  return cards
    .map((c) => {
      const f = c.querySelector('.shelf-face');
      const r = f.getBoundingClientRect();
      return { id: c.getAttribute('data-id'), x: r.left + r.width / 2, y: r.top + r.height / 2, vis: getComputedStyle(c).visibility };
    })
    .filter((c) => c.vis === 'visible' && Math.abs(c.x - mid) > 150)
    .sort((a, b) => Math.abs(b.x - mid) - Math.abs(a.x - mid))[0] ?? null;
})()`);
if (side === null) {
  console.log('no side card found; all cards centered');
} else {
  const clickedName = await evalJs(`(() => {
    const card = [...document.querySelectorAll('#shelf .shelf-card')].find((c) => c.getAttribute('data-id') === ${JSON.stringify(side.id)});
    return card?.querySelector('.shelf-name')?.textContent ?? null;
  })()`);
  console.log(`clicking side card ${JSON.stringify(clickedName)} at ${Math.round(side.x)},${Math.round(side.y)}`);
  await evalJs(`window.__smallProbe.start(140)`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(side.x), y: Math.round(side.y), button: 'left', clickCount: 1 });
  await sleep(40);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(side.x), y: Math.round(side.y), button: 'left', clickCount: 1 });
  await sleep(2100);
  const clickSamples = await evalJs(`window.__smallProbe.samples`);
  const clickAfter = await after();
  analyze('click', clickSamples);
  fact('click: clicked card centered after settle', clickAfter.centerName === clickedName, `center ${JSON.stringify(clickAfter.centerName)} clicked ${JSON.stringify(clickedName)}`);
}

console.log('');
console.log('=== TEST 4: reverse wheel (deltaY negative) from pos ' + (await evalJs(`window.__shelf.scroll()`)).toFixed(2) + ' ===');
await evalJs(`window.__smallProbe.start(110)`);
for (let i = 0; i < 2; i++) {
  await send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: Math.round(state.vw / 2),
    y: 400,
    deltaX: 0,
    deltaY: -120,
  });
  await sleep(80);
}
await sleep(1800);
const revSamples = await evalJs(`window.__smallProbe.samples`);
const revAfter = await after();
analyze('reverse-wheel', revSamples);
console.log(`center after reverse wheel: ${JSON.stringify(revAfter.centerName)}`);

console.log('');
console.log('=== TEST 5: wheel hard against the far end (expect a hard stop, nothing moves) ===');
await evalJs(`window.__shelf.goto(2)`);
await sleep(900);
console.log(`parked at pos ${(await evalJs(`window.__shelf.scroll()`)).toFixed(2)}`);
await evalJs(`window.__smallProbe.start(150)`);
for (let i = 0; i < 8; i++) {
  await send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: Math.round(state.vw / 2),
    y: 400,
    deltaX: 0,
    deltaY: -120,
  });
  await sleep(80);
}
await sleep(2200);
const wallSamples = await evalJs(`window.__smallProbe.samples`);
const wallAfter = await after();
analyze('wheel-at-wall', wallSamples);
const wallPosVals = wallSamples.map((s) => s.pos).filter((v) => typeof v === 'number');
const wallPeak = wallPosVals.length > 0 ? Math.max(...wallPosVals) : 0;
const wallEnd = wallPosVals[wallPosVals.length - 1] ?? 0;
const wallTravels = [];
for (let c = 0; c < (wallSamples[0]?.x.length ?? 0); c++) {
  const col = wallSamples.map((s) => s.x[c]).filter((v) => typeof v === 'number');
  if (col.length > 0) wallTravels.push(Math.max(...col) - Math.min(...col));
}
const wallMove = wallTravels.length > 0 ? Math.max(...wallTravels) : 0;
fact('wall: field never passed the bound', wallPeak <= 2.001, `peak pos ${wallPeak.toFixed(2)}`);
fact('wall: hard stop, no stretch motion', wallMove < 10, `${wallMove.toFixed(1)}px motion`);
fact('wall: boundary card centered', Math.abs(wallEnd - 2) < 0.06 && wallAfter.center === 2, `pos ${wallEnd.toFixed(2)}, center ${wallAfter.centerName}`);

console.log('');
console.log('=== TEST 6: every face stays visible at every resting position ===');
let allVisible = true;
const visibility = [];
for (let i = 0; i < 3; i++) {
  await evalJs(`window.__shelf.goto(${i})`);
  await sleep(800);
  const vis = await evalJs(`[...document.querySelectorAll('#shelf .shelf-card')].map((c) => ({
    v: getComputedStyle(c).visibility,
    o: +getComputedStyle(c).opacity,
    n: c.querySelector('.shelf-name')?.textContent ?? '',
  }))`);
  visibility.push(vis);
  const hidden = vis.filter((x) => x.v !== 'visible' || x.o < 0.5);
  if (hidden.length > 0) {
    allVisible = false;
    console.log(`pos ${i}: hidden or faint: ${JSON.stringify(hidden)}`);
  }
}
fact('small set: all faces visible at every resting position', allVisible, JSON.stringify(visibility.map((v) => v.map((x) => `${x.n}:${x.v}@${x.o}`))));

console.log('');
console.log('=== TEST 7: playlist squares carry their first song art ===');
const plFaces = await evalJs(`[...document.querySelectorAll('#shelf .shelf-card')].map((c) => ({
  n: c.querySelector('.shelf-name')?.textContent ?? '',
  plain: c.classList.contains('shelf-card-plain'),
  img: c.querySelector('.shelf-face img') !== null,
}))`);
fact('playlists: squares show album art, not initials', plFaces.length > 0 && plFaces.every((f) => !f.plain && f.img), JSON.stringify(plFaces));

console.log('');
const finalState = await evalJs(`({ pos: window.__shelf.scroll(), center: window.__shelf.center(), names: window.__shelf.names() })`);
console.log(`final: pos ${finalState.pos.toFixed(2)}, center idx ${finalState.center} of ${JSON.stringify(finalState.names)}`);
process.exit(0);
