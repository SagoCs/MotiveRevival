import net from 'node:net';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const port = process.env.SUMMON_PORT ?? '9222';
setTimeout(() => { console.error('probe watchdog: 120s without finishing'); process.exit(2); }, 120000).unref();

let page = null;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 700));
  try {
    const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
    page = targets.find((t) => t.type === 'page');
    if (page) break;
  } catch {}
}
if (!page) throw new Error(`no page target on port ${port} - launch the app with --remote-debugging-port=${port} first`);

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
const errors = [];
let phase = 'boot';
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
    if (!head.includes(' 101 ')) {
      console.error('handshake refused:', head.split('\r\n')[0]);
      process.exit(2);
    }
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
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        errors.push(`[${phase}] ${d.text} ${d.exception?.description ?? ''}`);
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        errors.push(`[${phase}] console.error: ` + JSON.stringify(msg.params.args));
      } else if (msg.id !== undefined && pending.has(msg.id)) {
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
function decode(png) {
  let pos = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (pos < png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.toString('ascii', pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 3;
  const px = Buffer.alloc(height * stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    for (let i = 0; i < stride; i++) {
      const left = i >= 3 ? px[y * stride + i - 3] : 0;
      const up = y > 0 ? px[(y - 1) * stride + i] : 0;
      const ul = y > 0 && i >= 3 ? px[(y - 1) * stride + i - 3] : 0;
      const cur = raw[rp + i];
      let val;
      if (filter === 0) val = cur;
      else if (filter === 1) val = cur + left;
      else if (filter === 2) val = cur + up;
      else if (filter === 3) val = cur + ((left + up) >> 1);
      else {
        const a = left; const b = up; const c = ul;
        const pa = Math.abs(b - c); const pb = Math.abs(a - c); const pc = Math.abs(a + b - 2 * c);
        val = cur + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      px[y * stride + i] = val & 0xff;
    }
    rp += stride;
  }
  return { width, height, px, stride };
}
async function screenshotClip(clip) {
  const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } });
  return Buffer.from(r.data, 'base64');
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

phase = 'open';
await evalJs(`document.querySelector('#summon-zone').click()`);
await sleep(400);
check('summon opens', await evalJs(`document.querySelector('#search-oracle').classList.contains('open')`));
const frameStyle = await evalJs(`(() => {
  const el = document.querySelector('#search-oracle');
  const cs = getComputedStyle(el);
  const before = getComputedStyle(el, '::before');
  return { border: cs.borderTopWidth, hairline: before.content !== 'none' && before.position === 'absolute', hairlineHeight: before.height };
})()`);
check('drawer frame is the single top hairline (frameless, hairline present)',
  frameStyle.border === '0px' && frameStyle.hairline === true, JSON.stringify(frameStyle));

async function summonQuery(q) {
  phase = `query:${q}`;
  await evalJs(`(() => { const i = document.querySelector('#oracle-input'); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(350);
  return evalJs(`(() => {
    const results = document.querySelector('#oracle-results');
    const labels = Array.from(results.querySelectorAll('.oracle-section-label')).map((n) => n.textContent);
    const rows = Array.from(results.querySelectorAll('[data-interactive]')).map((r) => ({
      cls: r.className,
      title: r.querySelector('.song-title')?.textContent ?? '',
      tinted: r.classList.contains('kind-song') && (r.style.background ?? '') !== '',
      artBg: (r.classList.contains('kind-album') || r.classList.contains('kind-artist') || r.classList.contains('kind-playlist')) && (r.style.backgroundImage ?? '') !== '',
      scrim: getComputedStyle(r, '::before').content !== 'none',
      isArtKind: r.classList.contains('kind-album') || r.classList.contains('kind-artist') || r.classList.contains('kind-playlist'),
    }));
    const counts = [];
    let cur = 0;
    for (const child of results.children) {
      if (child.classList.contains('oracle-section')) { if (cur > 0) counts.push(cur); cur = 0; }
      else if (child.dataset && child.dataset.interactive) cur += 1;
    }
    if (cur > 0) counts.push(cur);
    return { labels, rows, counts };
  })()`);
}

const kindOf = (r) => (r.cls.includes('kind-artist') ? 'artist' : r.cls.includes('kind-album') ? 'album' : r.cls.includes('kind-song') ? 'song' : 'playlist');

phase = 'mili';
const res = await summonQuery('mili');
check('results exist for "mili"', res.rows.length > 0, `${res.rows.length} rows in ${res.labels.length} sections`);
check('Artists leads the drawer', res.labels[0] === 'Artists', res.labels.join(' > '));
check('per-section cap honored (<=5)', res.counts.every((n) => n <= 5), JSON.stringify(res.counts));
check('every song row is a tinted rectangle', res.rows.filter((r) => kindOf(r) === 'song').every((r) => r.tinted));
check('every album/artist row carries art', res.rows.filter((r) => ['album', 'artist'].includes(kindOf(r))).every((r) => r.artBg));
check('art rows wear the text scrim, song rows do not',
  res.rows.every((r) => (r.isArtKind ? r.scrim === true : r.scrim === false)));

const subInk = await evalJs(`(() => {
  const probe = document.createElement('div');
  probe.className = 'dim';
  document.body.appendChild(probe);
  const dim = getComputedStyle(probe).color;
  probe.remove();
  const sub = document.querySelector('#oracle-results .song-sub');
  return { sub: sub ? getComputedStyle(sub).color : null, dim };
})()`);
const lumaOf = (color) => {
  const rgb = /rgba?\(([^)]+)\)/.exec(color);
  if (rgb !== null) {
    const parts = rgb[1].split(',').map((v) => parseFloat(v));
    return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
  }
  const srgb = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/.exec(color);
  if (srgb !== null) {
    const a = srgb[4] !== undefined ? parseFloat(srgb[4]) : 1;
    const l = 0.2126 * parseFloat(srgb[1]) + 0.7152 * parseFloat(srgb[2]) + 0.0722 * parseFloat(srgb[3]);
    return (l * a + 0.035 * (1 - a)) * 255;
  }
  return -1;
};
check('subtext ink is brighter than the dim default',
  subInk.sub !== null && lumaOf(subInk.sub) > lumaOf(subInk.dim),
  `sub=${subInk.sub} dim=${subInk.dim}`);

phase = 'song-lead';
const songLead = await summonQuery('turtle');
check('a song-title search leads with the Songs section', songLead.labels[0] === 'Songs', songLead.labels.join(' > '));

phase = 'tie-break';
const tie = await summonQuery('hero');
check('an exact song/album name tie seats Songs first', tie.labels[0] === 'Songs', tie.labels.join(' > '));

phase = 'arrow';
await evalJs(`document.querySelector('#oracle-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`);
await sleep(250);
const selected = await evalJs(`Array.from(document.querySelectorAll('#oracle-results [data-interactive]')).findIndex((r) => r.classList.contains('oracle-keyboard-selected'))`);
check('keyboard selection walks the sections', selected === 1, `selected index ${selected}`);

phase = 'typo';
const typo = await summonQuery('mlii');
check('typo "mlii" still finds Mili', typo.rows.some((r) => kindOf(r) === 'artist' && r.title === 'Mili'), `${typo.rows.length} rows`);

phase = 'gibberish';
const gibberish = await summonQuery('zzzqqq');
check('gibberish returns nothing', gibberish.rows.length === 0, `${gibberish.rows.length} rows`);

phase = 'pixel';
const pixelRes = await summonQuery('mili');
const songRows = pixelRes.rows.filter((r) => kindOf(r) === 'song');
if (songRows.length > 0) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4 });
  await sleep(150);
  const rect = await evalJs(`(() => {
    const r = document.querySelector('#oracle-results .kind-song');
    r.scrollIntoView({ block: 'center' });
    const b = r.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  })()`);
  const png = await screenshotClip({ x: rect.x, y: rect.y, width: rect.w, height: rect.h });
  const img = decode(png);
  const chans = [];
  for (let y = 0; y < img.height; y++) {
    for (let x = Math.floor(img.width * 0.4); x < Math.floor(img.width * 0.75); x++) {
      const o = y * img.stride + x * 3;
      const r = img.px[o];
      const g = img.px[o + 1];
      const b = img.px[o + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (luma < 60) chans.push(Math.max(r, g, b) - Math.min(r, g, b));
    }
  }
  chans.sort((a, b) => a - b);
  const p50 = chans[Math.floor(chans.length * 0.5)];
  check('song row wash carries chroma over void (channel spread)', p50 > 5, `p50=${p50.toFixed(1)}`);
} else {
  check('song row present for pixel check', false, 'no kind-song rows rendered');
}

phase = 'escape';
await evalJs(`document.querySelector('#oracle-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(300);
check('escape closes the summon', await evalJs(`!document.querySelector('#search-oracle').classList.contains('open')`));

phase = 'click-close';
await evalJs(`document.querySelector('#summon-zone').click()`);
await sleep(400);
await summonQuery('turtle');
const clicked = await evalJs(`(() => {
  const row = document.querySelector('#oracle-results .kind-song');
  row.click();
  return row.querySelector('.song-title').textContent;
})()`);
await sleep(1000);
check('clicking a song result closes the summon', await evalJs(`!document.querySelector('#search-oracle').classList.contains('open')`), `clicked "${clicked}"`);
check('clicked song is actually playing', await evalJs(`document.title.startsWith(${JSON.stringify(clicked)})`), await evalJs(`document.title`));

check('no renderer exceptions during probe', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
