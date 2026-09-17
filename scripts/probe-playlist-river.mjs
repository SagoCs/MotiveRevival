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

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
  if (!ok) failures.push(name);
};

await send('Page.enable');
await send('Page.reload');
await sleep(2600);

const ready = await evalJs(`window.__songActions !== undefined && window.__songActions.libraryTracks().length > 0`);
if (!ready) {
  console.log('library not ready');
  process.exit(1);
}

const plName = '__probe_pl';
const tracks = await evalJs(`(() => {
  const A = window.__songActions;
  const lib = A.libraryTracks();
  const pick = [];
  const albums = new Set();
  for (const t of lib) {
    const a = t.album ?? '';
    if (!albums.has(a)) { albums.add(a); pick.push(t); }
    if (pick.length === 3) break;
  }
  return pick.map((t) => ({ id: t.id, album: t.album ?? '' }));
})()`);
console.log(`picks: ${JSON.stringify(tracks)}`);
if (tracks.length < 3) {
  console.log('could not pick 3 distinct-album tracks');
  process.exit(1);
}

const created = await evalJs(`(async () => {
  const A = window.__songActions;
  for (const pl of A.playlists().filter((x) => x.name === '${plName}')) await A.removePlaylist(pl.id);
  const lib = A.libraryTracks();
  const real = ${JSON.stringify(tracks.map((t) => t.id))}.map((id) => lib.find((t) => t.id === id));
  const created = await A.createPlaylistWithTrack('${plName}', real[0]);
  await A.fileIntoPlaylist((A.playlists().find((p) => p.name === '${plName}')).id, real[1]);
  await A.fileIntoPlaylist((A.playlists().find((p) => p.name === '${plName}')).id, real[2]);
  return created;
})()`);
console.log(`created: ${created}`);

await evalJs(`document.querySelector('[data-mode="shelf"]').click()`);
await sleep(900);
await evalJs(`[...document.querySelectorAll('#shelf-lens button')].find((b) => b.textContent === 'Playlists').click()`);
await sleep(700);

const entry = await evalJs(`(() => {
  const e = window.__shelf.entries().find((x) => x.ref !== undefined && x.name === '${plName}');
  return e ?? null;
})()`);
console.log(`entry: ${JSON.stringify(entry)}`);
if (entry === null) {
  failures.push('scratch playlist square not found on the shelf');
} else {
  const entered = await evalJs(`window.__shelf.summonEnterPlaylist(${JSON.stringify(entry.ref)})`);
  check('summon landing accepted', entered === true);
  await sleep(3200);
  const state = await evalJs(`(() => {
    const anchor = document.querySelector('#playlist-river-anchor');
    return {
      open: window.__playlistRiver.isOpen(),
      anchorGone: anchor === null,
      cards: document.querySelectorAll('#playlist-river .rv2-card:not(.rv2-ghost)').length,
    };
  })()`);
  console.log(`open: ${JSON.stringify(state)}`);
  check('playlist river opened from the ceremony', state.open === true);
  check('anchor line is gone', state.anchorGone);
  check('three cards', state.cards === 3, String(state.cards));

  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(1600);
  const afterEsc = await evalJs(`(() => {
    const names = window.__shelf.names();
    return { open: window.__playlistRiver.isOpen(), lens: window.__shelf.lens(), center: names[window.__shelf.center()], shelf: window.__shelf.visible() };
  })()`);
  console.log(`escape: ${JSON.stringify(afterEsc)}`);
  check('escape closed the playlist river', afterEsc.open === false);
  check('escape returned to the playlists lens', afterEsc.lens === 'playlists' && afterEsc.center === plName && afterEsc.shelf === true);

  const rect = await evalJs(`(() => {
    const e = window.__shelf.entries().find((x) => x.ref !== undefined && x.name === '${plName}');
    const r = window.__shelf.rect(e.id);
    return r ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null;
  })()`);
  if (rect === null) {
    failures.push('centered playlist square has no rect');
  } else {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    await sleep(2200);
    const opened2 = await evalJs(`window.__playlistRiver.isOpen()`);
    check('center-click opens the playlist river', opened2 === true);
    const cards = await evalJs(`(() => {
      const out = [];
      for (const el of document.querySelectorAll('#playlist-river .rv2-card')) out.push({ id: el.dataset.id, tone: el.style.getPropertyValue('--rv2-tone').trim(), index: Number(el.dataset.index) });
      return out.sort((a, b) => a.index - b.index);
    })()`);
    console.log(`cards: ${JSON.stringify(cards)}`);
    check('three cards in playlist order', cards.length === 3 && cards[0].id === tracks[0].id && cards[1].id === tracks[1].id && cards[2].id === tracks[2].id, JSON.stringify(cards.map((c) => c.id)));
    const distinctTones = new Set(cards.map((c) => c.tone)).size;
    check('personal spectrum: distinct tones', distinctTones === 3, `${distinctTones} of 3`);

    const second = cards[1];
    const target = await evalJs(`(() => {
      const el = [...document.querySelectorAll('#playlist-river .rv2-card')].find((c) => c.dataset.index === '${second.index}');
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 });
    await sleep(1200);
    const overlayOpen = await evalJs(`document.querySelector('#overlay') ? !document.querySelector('#overlay').hidden : false`);
    if (overlayOpen) {
      console.log('replay path: the clicked song was already playing — now-playing opened, closing it');
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await sleep(900);
    }
    const ctx = await evalJs(`(() => {
      const s = window.__songActions.queueSnapshot();
      return { ids: s.ids, index: s.index, committed: document.querySelector('#playlist-river .rv2-card.committed')?.dataset.id ?? null };
    })()`);
    console.log(`click: ${JSON.stringify(ctx)}`);
    check('click plays the clicked song', ctx.index === 1 && ctx.ids[1] === second.id, JSON.stringify({ index: ctx.index, second: second.id }));
    check('playlist is the queue context', ctx.ids.length === 3 && ctx.ids[0] === tracks[0].id && ctx.ids[2] === tracks[2].id, JSON.stringify(ctx.ids));
    check('clicked card wears the committed bloom', ctx.committed === second.id, ctx.committed ?? 'none');

    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(1600);
    const closed = await evalJs(`({ open: window.__playlistRiver.isOpen(), lens: window.__shelf.lens() })`);
    check('esc returns to the playlists lens', closed.open === false && closed.lens === 'playlists', JSON.stringify(closed));
  }
}

const cleanup = await evalJs(`(async () => {
  const A = window.__songActions;
  const pl = A.playlists().find((p) => p.name === '${plName}');
  if (pl === undefined) return false;
  await A.removePlaylist(pl.id);
  return A.playlists().every((p) => p.name !== '${plName}');
})()`);
check('scratch playlist removed', cleanup === true);

ws.close();
if (failures.length > 0) {
  console.log(`FAIL: ${failures.join(' | ')}`);
  process.exit(1);
}
console.log('PLAYLIST RIVER VERIFIED');
process.exit(0);
