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

    const third = cards[2];
    const target = await evalJs(`(() => {
      const el = [...document.querySelectorAll('#playlist-river .rv2-card')].find((c) => c.dataset.index === '${third.index}');
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
    check('click plays the clicked song', ctx.index === 2 && ctx.ids[2] === third.id, JSON.stringify({ index: ctx.index, third: third.id }));
    check('playlist is the queue context', ctx.ids.length === 3 && ctx.ids[0] === tracks[0].id && ctx.ids[1] === tracks[1].id, JSON.stringify(ctx.ids));
    check('clicked card wears the committed bloom', ctx.committed === third.id, ctx.committed ?? 'none');

    const pinCheck = await evalJs(`(() => {
      const el = [...document.querySelectorAll('#playlist-river .rv2-card')][0];
      if (el === undefined) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), ids: window.__playlistRiver.ids() };
    })()`);
    check('pinned field located', pinCheck !== null && pinCheck.ids.length === 3, JSON.stringify(pinCheck));
    if (pinCheck !== null) {
      const vpPin = await evalJs(`({ w: window.innerWidth, h: window.innerHeight })`);
      for (let i = 0; i < 3; i++) {
        await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(vpPin.w / 2), y: Math.round(vpPin.h / 2), deltaX: 0, deltaY: -400 });
        await sleep(80);
      }
      await sleep(1400);
      const afterWheelPin = await evalJs(`(() => {
        const el = [...document.querySelectorAll('#playlist-river .rv2-card')][0];
        const r = el.getBoundingClientRect();
        return Math.round(r.top + r.height / 2);
      })()`);
      check('a small field does not scroll: the glow holds it', Math.abs(afterWheelPin - pinCheck.y) < 1, JSON.stringify({ before: pinCheck.y, after: afterWheelPin }));
    }

    const seamDrag = await evalJs(`(() => {
      const el = [...document.querySelectorAll('#playlist-river .rv2-card')].find((c) => c.dataset.id === ${JSON.stringify(tracks[0].id)});
      if (el === undefined) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, slot: (window.innerHeight - 52 - 62) / 7 };
    })()`);
    check('pinned drag target on screen', seamDrag !== null, JSON.stringify(seamDrag));
    if (seamDrag !== null) {
      const lift = Math.round(seamDrag.slot * 1.4);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(seamDrag.x), y: Math.round(seamDrag.y), button: 'left', clickCount: 1 });
      for (let s = 1; s <= 12; s++) {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(seamDrag.x), y: Math.round(seamDrag.y + (lift * s) / 12), button: 'left' });
        await sleep(40);
      }
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(seamDrag.x), y: Math.round(seamDrag.y + lift), button: 'left' });
      await sleep(1600);
    }
    const seamReordered = await evalJs(`(() => {
      const pl = window.__songActions.playlists().find((p) => p.name === '${plName}');
      return { ids: window.__playlistRiver.ids(), store: pl ? pl.tracks.map((t) => t.trackId) : [], departing: document.querySelectorAll('.rv2-departing').length };
    })()`);
    const seamExpected = [tracks[1].id, tracks[0].id, tracks[2].id];
    check('pinned field drag reorders', JSON.stringify(seamReordered.ids) === JSON.stringify(seamExpected), JSON.stringify({ got: seamReordered.ids, want: seamExpected }));
    check('pinned field drop persists to the store', JSON.stringify(seamReordered.store) === JSON.stringify(seamExpected), JSON.stringify(seamReordered.store));
    check('pinned commit leaves no departing ghosts behind', seamReordered.departing === 0, String(seamReordered.departing));

    const removeTarget = await evalJs(`(() => {
      const el = [...document.querySelectorAll('#playlist-river .rv2-card')].find((c) => c.dataset.id === ${JSON.stringify(tracks[0].id)});
      if (el === undefined) return null;
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    await sleep(450);
    const removeFork = await evalJs(`(() => ({
      menu: document.querySelector('.song-menu') !== null,
      btns: [...document.querySelectorAll('.sm-fork-btn')].map((b) => b.textContent),
      btn: (() => {
        const b = [...document.querySelectorAll('.sm-fork-btn')].find((x) => x.textContent === 'Remove from playlist');
        if (b === undefined) return null;
        const r = b.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })(),
    }))()`);
    check('playlist menu swaps the fork row inside a playlist', removeFork.menu === true && JSON.stringify(removeFork.btns) === JSON.stringify(['Add to queue', 'Remove from playlist']), JSON.stringify(removeFork.btns));
    if (removeFork.btn !== null) {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(removeFork.btn.x), y: Math.round(removeFork.btn.y), button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(removeFork.btn.x), y: Math.round(removeFork.btn.y), button: 'left', clickCount: 1 });
      await sleep(450);
    }
    const afterRemove = await evalJs(`(() => {
      const pl = window.__songActions.playlists().find((p) => p.name === '${plName}');
      return {
        menu: document.querySelector('.song-menu') !== null,
        ids: window.__playlistRiver.ids(),
        store: pl ? pl.tracks.map((t) => t.trackId) : [],
        cards: document.querySelectorAll('#playlist-river .rv2-card').length,
      };
    })()`);
    const removeExpected = [tracks[1].id, tracks[2].id];
    check('remove from playlist closes the menu and departs the card', afterRemove.menu === false && JSON.stringify(afterRemove.ids) === JSON.stringify(removeExpected) && JSON.stringify(afterRemove.store) === JSON.stringify(removeExpected) && afterRemove.cards === 2, JSON.stringify(afterRemove));
    await sleep(600);
    check('no removal residue remains', await evalJs(`document.querySelectorAll('.rv2-departing').length === 0`));

    const drain = await evalJs(`(async () => {
      const pl = window.__songActions.playlists().find((p) => p.name === '${plName}');
      if (pl === undefined) return false;
      await window.__songActions.removePlaylistTrack(pl.id, 0);
      await window.__songActions.removePlaylistTrack(pl.id, 0);
      return true;
    })()`);
    await sleep(1100);
    const drainedWorld = await evalJs(`(() => ({ open: window.__playlistRiver.isOpen(), cards: document.querySelectorAll('#playlist-river .rv2-card').length }))()`);
    check('removing the last card empties the world in place', drain === true && drainedWorld.open === true && drainedWorld.cards === 0, JSON.stringify(drainedWorld));
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(1600);
    const drainedEsc = await evalJs(`window.__playlistRiver.isOpen()`);
    check('esc leaves the emptied world', drainedEsc === false);
    const reentered = await evalJs(`window.__playlistRiver.open(${JSON.stringify(entry.ref)})`);
    await sleep(1400);
    const reentry = await evalJs(`(() => ({ open: window.__playlistRiver.isOpen(), cards: document.querySelectorAll('#playlist-river .rv2-card').length }))()`);
    check('an emptied playlist reopens as a void you can leave', reentered === true && reentry.open === true && reentry.cards === 0, JSON.stringify(reentry));
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(1600);
    check('esc leaves the reopened empty playlist', await evalJs(`window.__playlistRiver.isOpen() === false`));

    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(1600);
    const closed = await evalJs(`({ open: window.__playlistRiver.isOpen(), lens: window.__shelf.lens() })`);
    check('esc returns to the playlists lens', closed.open === false && closed.lens === 'playlists', JSON.stringify(closed));

    const ringIds = await evalJs(`(async () => {
      const A = window.__songActions;
      for (const pl of A.playlists().filter((x) => x.name === '__probe_ring')) await A.removePlaylist(pl.id);
      const lib = A.libraryTracks();
      const pick = [];
      const seen = new Set();
      for (const t of lib) { if (seen.has(t.id)) continue; seen.add(t.id); pick.push(t); if (pick.length === 8) break; }
      const outcome = await A.createPlaylistWithTrack('__probe_ring', pick[0]);
      if (outcome !== 'added') return null;
      for (let i = 1; i < pick.length; i++) {
        const pl = A.playlists().find((p) => p.name === '__probe_ring');
        if (pl === undefined) return null;
        await A.fileIntoPlaylist(pl.id, pick[i]);
      }
      const final = A.playlists().find((p) => p.name === '__probe_ring');
      return final ? final.tracks.map((t) => t.trackId) : null;
    })()`);
    console.log(`ring picks: ${ringIds === null ? null : ringIds.length}`);
    if (ringIds === null || ringIds.length !== 8) {
      failures.push('ring scratch playlist not created');
    } else {
      await evalJs(`document.querySelector('[data-mode="shelf"]').click()`);
      await sleep(900);
      const ringEntry = await evalJs(`(() => {
        const e = window.__shelf.entries().find((x) => x.ref !== undefined && x.name === '__probe_ring');
        return e ?? null;
      })()`);
      const enteredRing = await evalJs(`window.__shelf.summonEnterPlaylist(${JSON.stringify(ringEntry?.ref ?? '')})`);
      check('ring playlist accepted the summon landing', enteredRing === true);
      await sleep(3200);
      const ringOpen = await evalJs(`(() => ({ open: window.__playlistRiver.isOpen(), cards: document.querySelectorAll('#playlist-river .rv2-card').length }))()`);
      check('eight-song playlist opens the river', ringOpen.open === true && ringOpen.cards === 8, JSON.stringify(ringOpen));

      const vpRing = await evalJs(`({ w: window.innerWidth, h: window.innerHeight })`);
      for (let i = 0; i < 3; i++) {
        await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(vpRing.w / 2), y: Math.round(vpRing.h / 2), deltaX: 0, deltaY: 400 });
        await sleep(90);
      }
      await sleep(1600);
      const ringScroll = await evalJs(`window.__playlistRiver.scroll()`);
      check('the river rings: scroll runs past the first song without a wall', ringScroll < -0.3, `scroll ${Number(ringScroll).toFixed(2)}`);

      await evalJs(`window.__playlistRiver.close()`);
      await sleep(900);
      await evalJs(`window.__playlistRiver.open(${JSON.stringify(ringEntry?.ref ?? '')})`);
      await sleep(1400);
      const dragRing = await evalJs(`(() => {
        const el = [...document.querySelectorAll('#playlist-river .rv2-card')].find((c) => c.dataset.id === ${JSON.stringify(ringIds[0])});
        if (el === undefined) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`);
      check('ring drag target on screen', dragRing !== null, JSON.stringify(dragRing));
      if (dragRing !== null) {
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(dragRing.x), y: Math.round(dragRing.y), button: 'left', clickCount: 1 });
        for (let s = 1; s <= 12; s++) {
          await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(dragRing.x), y: Math.round(dragRing.y + s * 13), button: 'left' });
          await sleep(40);
        }
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(dragRing.x), y: Math.round(dragRing.y + 156), button: 'left' });
        await sleep(1600);
      }
      const ringReordered = await evalJs(`(() => {
        const pl = window.__songActions.playlists().find((p) => p.name === '__probe_ring');
        return { ids: window.__playlistRiver.ids(), store: pl ? pl.tracks.map((t) => t.trackId) : [], departing: document.querySelectorAll('.rv2-departing').length };
      })()`);
      const ringExpected = [ringIds[1], ringIds[0], ...ringIds.slice(2)];
      check('ring drag reorders the circle', JSON.stringify(ringReordered.ids) === JSON.stringify(ringExpected), JSON.stringify({ got: ringReordered.ids, want: ringExpected }));
      check('ring drop persists to the store', JSON.stringify(ringReordered.store) === JSON.stringify(ringExpected), JSON.stringify(ringReordered.store));
      check('ring commit leaves no departing ghosts behind', ringReordered.departing === 0, String(ringReordered.departing));

      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await sleep(1600);
      const ringGone = await evalJs(`window.__playlistRiver.isOpen()`);
      check('esc leaves the ring river', ringGone === false);
    }

    const ringCleanup = await evalJs(`(async () => {
      const A = window.__songActions;
      for (const pl of A.playlists().filter((x) => x.name === '__probe_ring')) await A.removePlaylist(pl.id);
      return A.playlists().every((p) => p.name !== '__probe_ring');
    })()`);
    check('ring scratch playlist removed', ringCleanup === true);
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
