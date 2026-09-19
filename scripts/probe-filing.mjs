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

const realClick = async (pt) => {
  if (pt === null) return false;
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  return true;
};

const forkPoint = (label) => evalJs(`(() => {
  const b = Array.from(document.querySelectorAll('.sm-fork-btn')).find((x) => x.textContent === ${JSON.stringify(label)});
  if (b === undefined) return null;
  const r = b.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`);

const cardPoint = (sel) => evalJs(`(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (el === null) return null;
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`);

const squarePoint = (id) => evalJs(`(() => {
  const el = document.querySelector('#shelf .shelf-card[data-id="' + ${JSON.stringify(id)} + '"]');
  if (el === null) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 40) return null;
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`);

const escape = () => evalJs(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);

const removeScratch = async (name) => {
  await evalJs(`(async () => {
    const A = window.__songActions;
    for (const pl of A.playlists().filter((x) => x.name === ${JSON.stringify(name)})) await A.removePlaylist(pl.id);
  })()`);
};

await send('Page.enable');
await send('Page.reload');
await sleep(3000);

const ready = await evalJs(`window.__songActions !== undefined && window.__songActions.libraryTracks().length > 0 && window.__shelf !== undefined`);
if (!ready) {
  console.log('app not ready');
  process.exit(1);
}

for (const name of ['__probe_file', '__probe_file2', '__probe_new', '__probe_empty2']) await removeScratch(name);

await evalJs(`document.querySelector('#mode-tabs button[data-mode="songs"]')?.click()`);
await sleep(1200);
const riverOn = await evalJs(`document.getElementById('river-v2').classList.contains('on')`);
check('songs river is the live surface', riverOn === true);

const cardTitle = await evalJs(`(() => {
  const cards = Array.from(document.querySelectorAll('#river-v2 .rv2-card'));
  const tallest = Math.max(...cards.map((c) => c.getBoundingClientRect().height));
  const c = cards.filter((x) => x.getBoundingClientRect().height > tallest * 0.62).sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
  return c === undefined ? null : (c.querySelector('.rv2-title') ?? c.querySelector('.rv2-text'))?.textContent ?? null;
})()`);

const seed = await evalJs(`(async () => {
  const A = window.__songActions;
  const lib = A.libraryTracks();
  const song = lib.find((t) => t.title === ${JSON.stringify(cardTitle ?? '')}) ?? lib[0];
  const other = lib.find((t) => t.title !== song.title) ?? lib[0];
  await A.createPlaylistWithTrack('__probe_file', other);
  await A.createPlaylistWithTrack('__probe_file2', other);
  const filePl = A.playlists().find((p) => p.name === '__probe_file');
  const filePl2 = A.playlists().find((p) => p.name === '__probe_file2');
  return { songId: song.id, songTitle: song.title, fileRef: filePl.id, file2Ref: filePl2.id };
})()`);
check('scratch playlists seeded', seed !== null && seed.fileRef !== undefined, JSON.stringify(seed));
await sleep(400);

await evalJs(`(() => {
  const cards = Array.from(document.querySelectorAll('#river-v2 .rv2-card'));
  const tallest = Math.max(...cards.map((c) => c.getBoundingClientRect().height));
  const c = cards.filter((x) => x.getBoundingClientRect().height > tallest * 0.62).sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
  if (c !== undefined) c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
})()`);
await sleep(400);
await realClick(await forkPoint('Add to playlist'));
await sleep(800);
const takeover = await evalJs(`(() => {
  const title = document.querySelector('.shelf-lens-title');
  return {
    filing: window.__shelf.filing(),
    track: window.__shelf.filingTrack(),
    menuGone: document.querySelector('.song-menu') === null,
    titleShown: title !== null && getComputedStyle(title).display !== 'none',
    plusThere: document.querySelector('#shelf .shelf-card[data-id="new:playlist"]') !== null,
    lens: window.__shelf.lens(),
  };
})()`);
check('fork hands the song to the filing lens', takeover.filing === true && takeover.menuGone === true && takeover.titleShown === true && takeover.plusThere === true && takeover.lens === 'playlists', JSON.stringify(takeover));
check('the held song is the right one', takeover.track === seed.songTitle, takeover.track);

const entryIdx = await evalJs(`window.__shelf.entries().findIndex((e) => e.name === '__probe_file')`);
await evalJs(`window.__shelf.goto(${entryIdx})`);
await sleep(900);
await realClick(await squarePoint(`playlist:${seed.fileRef}`));
await sleep(700);
const added = await evalJs(`(() => {
  const A = window.__songActions;
  const pl = A.playlists().find((p) => p.name === '__probe_file');
  return {
    word: window.__shelf.speakWord(),
    speakOn: window.__shelf.speakOn(),
    filed: pl !== undefined && A.playlistContains(pl.id, ${JSON.stringify(seed.songId)}),
  };
})()`);
check('click files the song and speaks Added over the square', added.speakOn === true && added.word === 'Added' && added.filed === true, JSON.stringify(added));
await sleep(2600);
check('the world returns home after the word', await evalJs(`window.__shelf.filing() === false && document.getElementById('river-v2').classList.contains('on')`));

await evalJs(`window.__shelf.beginFiling(${JSON.stringify(seed.songId)})`);
await sleep(500);
const entryIdx2 = await evalJs(`window.__shelf.entries().findIndex((e) => e.name === '__probe_file')`);
await evalJs(`window.__shelf.goto(${entryIdx2})`);
await sleep(900);
await realClick(await squarePoint(`playlist:${seed.fileRef}`));
await sleep(700);
const already = await evalJs(`(() => ({
  word: window.__shelf.speakWord(),
  speakOn: window.__shelf.speakOn(),
  stillFiling: window.__shelf.filing(),
}))()`);
check('a second file answers Already there and stays', already.speakOn === true && already.word === 'Already there' && already.stillFiling === true, JSON.stringify(already));
await escape();
await sleep(700);
check('escape cancels after Already there', await evalJs(`window.__shelf.filing() === false`));

await evalJs(`window.__shelf.beginFiling(${JSON.stringify(seed.songId)})`);
await sleep(500);
await evalJs(`window.__shelf.goto(window.__shelf.entries().findIndex((e) => e.name === '__probe_file2'))`);
await sleep(900);
await evalJs(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
await sleep(2400);
const byEnter = await evalJs(`(() => {
  const A = window.__songActions;
  const pl = A.playlists().find((p) => p.name === '__probe_file2');
  return { filed: pl !== undefined && A.playlistContains(pl.id, ${JSON.stringify(seed.songId)}), home: window.__shelf.filing() === false };
})()`);
check('enter files the centered square', byEnter.filed === true && byEnter.home === true, JSON.stringify(byEnter));

await evalJs(`window.__shelf.beginFiling(${JSON.stringify(seed.songId)})`);
await sleep(500);
const plusIdx = await evalJs(`Number(document.querySelector('#shelf .shelf-card[data-id="new:playlist"]')?.dataset.index ?? -1)`);
check('+ square present in the field', plusIdx >= 0, String(plusIdx));
await evalJs(`window.__shelf.goto(${plusIdx})`);
await sleep(900);
const plusRect = await squarePoint('new:playlist');
check('+ square reached at the end of the field', plusRect !== null);
await realClick(plusRect);
await sleep(600);
const promptOn = await evalJs(`(() => ({
  open: window.__shelf.prompt(),
  focused: document.activeElement === document.querySelector('.shelf-prompt-input'),
}))()`);
check('the + square opens the naming prompt', promptOn.open === true && promptOn.focused === true, JSON.stringify(promptOn));
await evalJs(`(() => {
  const input = document.querySelector('.shelf-prompt-input');
  input.value = '__probe_new';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
})()`);
await sleep(2600);
const created = await evalJs(`(() => {
  const A = window.__songActions;
  const pl = A.playlists().find((p) => p.name === '__probe_new');
  return { made: pl !== undefined, filed: pl !== undefined && A.playlistContains(pl.id, ${JSON.stringify(seed.songId)}), home: window.__shelf.filing() === false };
})()`);
check('the prompt creates and files, then returns home', created.made === true && created.filed === true && created.home === true, JSON.stringify(created));

await evalJs(`window.__shelf.beginFiling(${JSON.stringify(seed.songId)})`);
await sleep(500);
await evalJs(`window.__shelf.goto(Number(document.querySelector('#shelf .shelf-card[data-id="new:playlist"]')?.dataset.index ?? 0))`);
await sleep(900);
await realClick(await squarePoint('new:playlist'));
await sleep(600);
await evalJs(`(() => {
  const input = document.querySelector('.shelf-prompt-input');
  input.value = '__probe_new';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
})()`);
await sleep(500);
await sleep(500);
const refused = await evalJs(`(() => ({
  message: window.__shelf.promptMessage(),
  stillOpen: window.__shelf.prompt(),
}))()`);
check('a duplicate name fades into Name already taken', refused.message === 'Name already taken' && refused.stillOpen === true, JSON.stringify(refused));
await sleep(1200);
check('the message fades back to the typed name', await evalJs(`window.__shelf.promptMessage() === ''`));
await escape();
await sleep(400);
check('first escape clears the text and stays', await evalJs(`window.__shelf.prompt() === true && window.__shelf.filing() === true`));
await escape();
await sleep(900);
check('second escape parts the field home', await evalJs(`window.__shelf.prompt() === false && window.__shelf.filing() === true`));
await escape();
await sleep(700);
check('third escape cancels filing', await evalJs(`window.__shelf.filing() === false`));

await evalJs(`document.querySelector('#mode-tabs button[data-mode="shelf"]')?.click()`);
await sleep(900);
await evalJs(`document.querySelector('#shelf-lens button:nth-child(2)')?.click()`);
await sleep(900);
await evalJs(`window.__shelf.goto(Number(document.querySelector('#shelf .shelf-card[data-id="new:playlist"]')?.dataset.index ?? 0))`);
await sleep(900);
await evalJs(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
await sleep(600);
const plainCreate = await evalJs(`window.__shelf.prompt() === true && window.__shelf.filing() === false`);
check('the + square creates in normal browsing too', plainCreate === true);
await evalJs(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(1000);
check('escape parts the field home in normal browsing', await evalJs(`window.__shelf.prompt() === false`));
await evalJs(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
await sleep(800);
await evalJs(`(() => {
  const input = document.querySelector('.shelf-prompt-input');
  input.value = '__probe_empty2';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
})()`);
await sleep(900);
const emptyMade = await evalJs(`(() => {
  const A = window.__songActions;
  const pl = A.playlists().find((p) => p.name === '__probe_empty2');
  return { made: pl !== undefined, empty: pl !== undefined && pl.tracks.length === 0 };
})()`);
check('an empty playlist is created without a held song', emptyMade.made === true && emptyMade.empty === true, JSON.stringify(emptyMade));
await sleep(2300);
const landed = await evalJs(`(() => ({
  gone: window.__shelf.prompt() === false,
  center: window.__shelf.names()[window.__shelf.center()],
}))()`);
check('the field returns onto the new square', landed.gone === true && landed.center === '__probe_empty2', JSON.stringify(landed));

const artistName = await evalJs(`window.__songActions.libraryTracks().find((x) => x.palette !== null)?.artist ?? null`);
const enteredArtist = await evalJs(`window.__shelf.summonEnter(${JSON.stringify(artistName)})`);
check('artist river entered for the suspension test', enteredArtist === true, String(artistName));
await sleep(2600);
await evalJs(`(() => {
  const cards = Array.from(document.querySelectorAll('#artist-river .rv2-card'));
  const tallest = Math.max(...cards.map((c) => c.getBoundingClientRect().height));
  const c = cards.filter((x) => x.getBoundingClientRect().height > tallest * 0.62).sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
  if (c !== undefined) c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
})()`);
await sleep(400);
await realClick(await forkPoint('Add to playlist'));
await sleep(800);
const suspended = await evalJs(`(() => ({
  filing: window.__shelf.filing(),
  riverHidden: getComputedStyle(document.getElementById('artist-river')).display === 'none',
  floorHidden: getComputedStyle(document.getElementById('artist-river-floor')).display === 'none',
}))()`);
check('filing from a river suspends the origin world', suspended.filing === true && suspended.riverHidden === true && suspended.floorHidden === true, JSON.stringify(suspended));
await escape();
await sleep(900);
const restored = await evalJs(`(() => ({
  filing: window.__shelf.filing(),
  riverBack: getComputedStyle(document.getElementById('artist-river')).display !== 'none' && window.__artistRiver.isOpen(),
}))()`);
check('escape restores the suspended origin', restored.filing === false && restored.riverBack === true, JSON.stringify(restored));
await escape();
await sleep(800);

await evalJs(`window.__shelf.beginFiling(${JSON.stringify(seed.songId)})`);
await sleep(500);
await evalJs(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))`);
await sleep(600);
const abandoned = await evalJs(`window.__shelf.filing() === false && document.getElementById('search-oracle').classList.contains('open')`);
check('opening the summon abandons the pending song', abandoned === true);
await escape();
await sleep(400);

for (const name of ['__probe_file', '__probe_file2', '__probe_new', '__probe_empty2']) await removeScratch(name);
const clean = await evalJs(`window.__songActions.playlists().every((p) => !p.name.startsWith('__probe'))`);
check('scratch playlists cleaned up', clean === true);

console.log(failures.length === 0 ? 'ALL GREEN' : `${failures.length} FAILED`);
ws.close();
process.exit(failures.length === 0 ? 0 : 1);
